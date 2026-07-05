import { createUuid } from './uuid';
import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import { throwIfSupabaseError, toSupabaseQueryError } from './supabaseQueryHelpers';
import type {
  FirmSubscription,
  PaymentRecord,
  SaasPlanType,
  SaasSubscription,
  SubscriptionPlanId,
  SubscriptionRequest
} from '../types/app';
import { getPlanLabel } from '../constants/subscription';

const SUBSCRIPTION_CACHE_KEY = 'legalmind_firm_subscription_v1';

export function cacheFirmSubscription(subscription: FirmSubscription): void {
  try {
    localStorage.setItem(SUBSCRIPTION_CACHE_KEY, JSON.stringify(subscription));
  } catch {
    /* ignore quota errors */
  }
}

export function readCachedFirmSubscription(): FirmSubscription | null {
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FirmSubscription;
  } catch {
    return null;
  }
}

const RECEIPT_MAX_SIZE = 5 * 1024 * 1024;
const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export function validateReceiptFile(file: File): { valid: boolean; error?: string } {
  if (file.size === 0) return { valid: false, error: 'الملف فارغ.' };
  if (file.size > RECEIPT_MAX_SIZE) return { valid: false, error: 'حجم الملف يتجاوز 5 ميجابايت.' };
  if (!RECEIPT_TYPES.has(file.type)) {
    return { valid: false, error: 'نوع الملف غير مدعوم. استخدم JPG أو PNG أو PDF.' };
  }
  return { valid: true };
}

function receiptExtension(file: File): string {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export function mapPlanIdToSaasPlanType(plan: SubscriptionPlanId): SaasPlanType {
  if (plan === 'annual') return 'yearly';
  if (plan === 'quarterly') return 'quarterly';
  return 'monthly';
}

export async function fetchFirmSubscription(): Promise<FirmSubscription> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('firms')
    .select(
      'id, subscription_status, subscription_plan, subscription_expires_at, is_locked, plan'
    )
    .eq('id', firmId)
    .single();
  throwIfSupabaseError(error);

  const row = data as {
    id: string;
    subscription_status: FirmSubscription['status'];
    subscription_plan: SubscriptionPlanId;
    subscription_expires_at: string | null;
    is_locked: boolean;
    plan: string;
  };

  const expiresAt = row.subscription_expires_at;
  const expiredByDate = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
  const isLocked = row.is_locked || expiredByDate || row.subscription_status === 'expired';

  return {
    firmId: row.id,
    status: expiredByDate && row.subscription_status !== 'expired' ? 'expired' : row.subscription_status,
    plan: row.subscription_plan,
    expiresAt,
    isLocked,
    isActive: !isLocked && ['trial', 'active'].includes(row.subscription_status) && !expiredByDate,
    legacyPlan: row.plan
  };
}

export async function fetchFirmSubscriptionWithCache(): Promise<FirmSubscription> {
  try {
    const subscription = await fetchFirmSubscription();
    cacheFirmSubscription(subscription);
    return subscription;
  } catch (err) {
    const cached = readCachedFirmSubscription();
    if (cached) return cached;
    throw err;
  }
}

export async function fetchFirmSaasSubscriptions(): Promise<SaasSubscription[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(20);
  throwIfSupabaseError(error);
  return (data ?? []).map(mapDbSaasSubscription);
}

export async function fetchFirmPayments(): Promise<PaymentRecord[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(20);
  throwIfSupabaseError(error);
  return (data ?? []).map(mapDbPayment);
}

export async function fetchSubscriptionRequests(): Promise<SubscriptionRequest[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('subscription_requests')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(20);
  throwIfSupabaseError(error);
  return (data ?? []).map(mapDbSubscriptionRequest);
}

export async function submitSubscriptionRequest(input: {
  plan: Exclude<SubscriptionPlanId, 'trial'>;
  amountYer: number;
  transferReference: string;
  receiptFile: File;
}): Promise<SubscriptionRequest> {
  const validation = validateReceiptFile(input.receiptFile);
  if (!validation.valid) throw new Error(validation.error ?? 'ملف غير صالح');

  const firmId = await getCurrentFirmId();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error('غير مسجل الدخول');

  const requestId = createUuid();
  const ext = receiptExtension(input.receiptFile);
  const path = `${firmId}/${requestId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('subscription-receipts')
    .upload(path, input.receiptFile, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.receiptFile.type
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data: urlData } = supabase.storage.from('subscription-receipts').getPublicUrl(path);

  const { error: rpcError } = await supabase.rpc('submit_subscription_request', {
    p_plan: input.plan,
    p_amount_yer: input.amountYer,
    p_transfer_reference: input.transferReference.trim(),
    p_receipt_path: path,
    p_receipt_url: urlData.publicUrl,
    p_request_id: requestId
  });
  if (rpcError) {
    if (/pending_request_exists/i.test(rpcError.message)) {
      throw new Error('يوجد طلب تجديد قيد المراجعة بالفعل.');
    }
    if (/submit_subscription_request|42883|does not exist/i.test(rpcError.message)) {
      throw new Error('نظام الدفع غير مفعّل بعد. تواصل مع الدعم لتطبيق migrations 044–050.');
    }
    if (/not_authorized|firm_id/i.test(rpcError.message)) {
      throw new Error('لا يمكن إرسال طلب الدفع — تأكد من تسجيل الدخول وربط حسابك بمكتب.');
    }
    throw toSupabaseQueryError(rpcError);
  }

  const { data, error } = await supabase
    .from('subscription_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  throwIfSupabaseError(error);
  return mapDbSubscriptionRequest(data);
}

export interface AdminSubscriptionRequest extends SubscriptionRequest {
  firmName?: string;
}

export async function fetchPendingPaymentsAdmin(): Promise<PaymentRecord[]> {
  const { data: isAdmin, error: accessError } = await supabase.rpc('is_billing_admin');
  if (accessError && /is_billing_admin|42883|does not exist/i.test(accessError.message)) {
    throw new Error('نظام الموافقة غير مفعّل. طبّق migrations 056–057 في Supabase SQL Editor.');
  }
  if (!isAdmin) {
    throw new Error('NOT_BILLING_ADMIN');
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('list_pending_subscription_requests_admin');

  if (!rpcError && Array.isArray(rpcData)) {
    return mapAdminPendingRpcRows(rpcData);
  }

  const rpcRecoverable =
    !rpcError ||
    /list_pending_subscription_requests_admin|42883|does not exist|could not find|map_plan_to_plan_type|relation.*payments|relation.*subscriptions|not_authorized/i.test(
      rpcError.message
    );

  if (rpcError && !rpcRecoverable) {
    throw toSupabaseQueryError(rpcError);
  }

  const extendedSelect = `
    id,
    firm_id,
    plan,
    amount_yer,
    transfer_reference,
    receipt_path,
    receipt_url,
    created_at,
    payment_id,
    subscription_id,
    firms!firm_id(name)
  `;

  let data: Record<string, unknown>[] | null = null;
  let error: Parameters<typeof throwIfSupabaseError>[0] = null;

  const extendedResult = await supabase
    .from('subscription_requests')
    .select(extendedSelect)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  data = (extendedResult.data ?? null) as Record<string, unknown>[] | null;
  error = extendedResult.error;

  if (error && /payment_id|subscription_id|column|does not exist/i.test(error.message)) {
    const basicResult = await supabase
      .from('subscription_requests')
      .select(`
        id,
        firm_id,
        plan,
        amount_yer,
        transfer_reference,
        receipt_path,
        receipt_url,
        created_at,
        firms!firm_id(name)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    data = (basicResult.data ?? null) as Record<string, unknown>[] | null;
    error = basicResult.error;
  }

  if (error && /firms|relationship|schema cache/i.test(error.message)) {
    const minimalResult = await supabase
      .from('subscription_requests')
      .select(`
        id,
        firm_id,
        plan,
        amount_yer,
        transfer_reference,
        receipt_path,
        receipt_url,
        created_at
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    data = (minimalResult.data ?? null) as Record<string, unknown>[] | null;
    error = minimalResult.error;
  }

  throwIfSupabaseError(error);

  const firmNames = await fetchFirmNamesForIds(
    [...new Set((data ?? []).map((row) => row.firm_id as string).filter(Boolean))]
  );

  return (data ?? []).map((row) => mapAdminPendingRequestRow(row, firmNames));
}

function mapAdminPendingRpcRows(rows: unknown[]): PaymentRecord[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const plan = r.plan as SubscriptionPlanId;
    const planType = (r.plan_type as SaasPlanType) ?? mapPlanIdToSaasPlanType(plan);
    const requestId = String(r.request_id ?? r.payment_id ?? '');
    return {
      id: requestId,
      firmId: r.firm_id as string,
      subscriptionId: (r.subscription_id as string) ?? '',
      amount: Number(r.amount_yer),
      paymentMethod: 'bank_transfer',
      receiptUrl: (r.receipt_url as string | null) ?? undefined,
      proofOfPaymentUrl: (r.proof_of_payment_url as string | null) ?? undefined,
      status: 'pending' as const,
      createdAt: r.created_at as string,
      firmName: r.firm_name as string,
      planType,
      planLabel: getPlanLabel(plan),
      transferReference: r.transfer_reference as string,
      receiptPath: r.receipt_path as string,
      requestId
    };
  });
}

async function fetchFirmNamesForIds(firmIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (firmIds.length === 0) return names;

  const { data, error } = await supabase.from('firms').select('id, name').in('id', firmIds);
  if (error) return names;

  for (const row of data ?? []) {
    names.set(row.id as string, row.name as string);
  }
  return names;
}

function mapAdminPendingRequestRow(
  row: Record<string, unknown>,
  firmNames: Map<string, string>
): PaymentRecord {
  const firms = row.firms as { name?: string } | null;
  const firmId = row.firm_id as string;
  const requestId = row.id as string;
  return {
    id: requestId,
    firmId,
    subscriptionId: (row.subscription_id as string) ?? '',
    amount: Number(row.amount_yer),
    paymentMethod: 'bank_transfer',
    receiptUrl: (row.receipt_url as string | null) ?? undefined,
    proofOfPaymentUrl: (row.receipt_url as string | null) ?? undefined,
    status: 'pending' as const,
    createdAt: row.created_at as string,
    firmName: firms?.name ?? firmNames.get(firmId),
    planType: mapPlanIdToSaasPlanType(row.plan as SubscriptionPlanId),
    planLabel: getPlanLabel(row.plan as SubscriptionPlanId),
    transferReference: row.transfer_reference as string,
    receiptPath: row.receipt_path as string,
    requestId
  };
}

export async function fetchBillingAdminDiagnostics(): Promise<{
  isBillingAdmin: boolean;
  isPlatformOperator: boolean;
  isSubscriptionSuperAdmin: boolean;
  rpcReady: boolean;
  errors: string[];
}> {
  const [billing, platform, superAdmin] = await Promise.all([
    supabase.rpc('is_billing_admin'),
    supabase.rpc('is_platform_operator'),
    supabase.rpc('is_subscription_super_admin')
  ]);

  const errors = [billing.error, platform.error, superAdmin.error]
    .filter(Boolean)
    .map((err) => err!.message);

  const rpcReady = !billing.error || !/is_billing_admin|42883|does not exist/i.test(billing.error.message);

  return {
    isBillingAdmin: Boolean(billing.data),
    isPlatformOperator: Boolean(platform.data),
    isSubscriptionSuperAdmin: Boolean(superAdmin.data),
    rpcReady,
    errors
  };
}

export async function claimBillingAdminSetup(): Promise<void> {
  const { data, error } = await supabase.rpc('claim_billing_admin_setup');
  if (error) {
    if (/not_authorized/i.test(error.message)) {
      throw new Error('لا يمكن منح الصلاحية — يوجد مسؤول فوترة آخر.');
    }
    if (/employee_not_found/i.test(error.message)) {
      throw new Error('لم يُعثر على سجل موظف مرتبط بحسابك.');
    }
    if (/claim_billing_admin_setup|42883|does not exist/i.test(error.message)) {
      throw new Error('نفّذ migration 048 في Supabase SQL Editor أولاً.');
    }
    throw toSupabaseQueryError(error);
  }
  if (!(data as { ok?: boolean } | null)?.ok) {
    throw new Error('تعذر تفعيل صلاحيات الأدمن.');
  }
}

/** @deprecated Use fetchPendingPaymentsAdmin */
export async function fetchPendingSubscriptionRequestsAdmin(): Promise<AdminSubscriptionRequest[]> {
  const payments = await fetchPendingPaymentsAdmin();
  return payments.map((payment) => ({
    id: payment.requestId ?? payment.id,
    firmId: payment.firmId,
    firmName: payment.firmName,
    plan: payment.planType === 'yearly' ? 'annual' : (payment.planType ?? 'monthly'),
    amountYer: payment.amount,
    transferReference: payment.transferReference ?? '',
    receiptPath: payment.receiptPath ?? '',
    receiptUrl: payment.receiptUrl,
    status: 'pending',
    createdAt: payment.createdAt,
    paymentId: payment.id,
    subscriptionId: payment.subscriptionId
  }));
}

export async function getSubscriptionReceiptSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('subscription-receipts').createSignedUrl(path, 3600);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('تعذر فتح إشعار التحويل.');
  return data.signedUrl;
}

function mapSubscriptionReviewError(message: string): Error {
  if (/rejection_reason_required/i.test(message)) {
    return new Error('سبب الرفض مطلوب.');
  }
  if (/not_authorized/i.test(message)) {
    return new Error('ليس لديك صلاحية مراجعة الاشتراكات. هذه الصفحة للسوبر أدمن فقط.');
  }
  if (/request_not_pending/i.test(message)) {
    return new Error('تمت معالجة هذا الطلب مسبقاً. حدّث الصفحة.');
  }
  if (/request_not_found|payment_not_found/i.test(message)) {
    return new Error('تعذر العثور على طلب الاشتراك. حدّث الصفحة ثم أعد المحاولة.');
  }
  if (/subscription_fields_protected/i.test(message)) {
    return new Error('تعذر تفعيل الاشتراك — طبّق migration 058 في Supabase SQL Editor.');
  }
  if (/invalid_action/i.test(message)) {
    return new Error('إجراء غير صالح.');
  }
  return new Error(message || 'فشلت مراجعة طلب الاشتراك.');
}

export async function reviewPayment(input: {
  paymentId: string;
  action: 'approve' | 'reject';
  rejectionReason?: string;
  requestId?: string;
}): Promise<void> {
  const requestId = input.requestId ?? input.paymentId;
  if (!requestId) {
    throw new Error('معرّف الطلب غير متوفر.');
  }

  const { error: reqError } = await supabase.rpc('review_subscription_request', {
    p_request_id: requestId,
    p_action: input.action,
    p_admin_notes: input.rejectionReason ?? null
  });
  if (!reqError) return;

  if (!/request_not_found|payment_not_found/i.test(reqError.message)) {
    throw mapSubscriptionReviewError(reqError.message);
  }

  const { error } = await supabase.rpc('review_payment', {
    p_payment_id: input.paymentId,
    p_action: input.action,
    p_rejection_reason: input.rejectionReason ?? null
  });
  if (!error) return;

  throw mapSubscriptionReviewError(error.message);
}

export async function reviewSubscriptionRequest(input: {
  requestId: string;
  action: 'approve' | 'reject';
  adminNotes?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('review_subscription_request', {
    p_request_id: input.requestId,
    p_action: input.action,
    p_admin_notes: input.adminNotes ?? null
  });
  if (error) {
    throw mapSubscriptionReviewError(error.message);
  }
}

function mapDbSubscriptionRequest(row: Record<string, unknown>): SubscriptionRequest {
  return {
    id: row.id as string,
    firmId: row.firm_id as string,
    plan: row.plan as SubscriptionPlanId,
    amountYer: Number(row.amount_yer),
    transferReference: row.transfer_reference as string,
    receiptPath: row.receipt_path as string,
    receiptUrl: (row.receipt_url as string | null) ?? undefined,
    status: row.status as SubscriptionRequest['status'],
    adminNotes: (row.admin_notes as string | null) ?? undefined,
    createdAt: row.created_at as string,
    reviewedAt: (row.reviewed_at as string | null) ?? undefined,
    subscriptionId: (row.subscription_id as string | null) ?? undefined,
    paymentId: (row.payment_id as string | null) ?? undefined
  };
}

function mapDbSaasSubscription(row: Record<string, unknown>): SaasSubscription {
  return {
    id: row.id as string,
    firmId: row.firm_id as string,
    planType: row.plan_type as SaasPlanType,
    status: row.status as SaasSubscription['status'],
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

function mapDbPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    id: row.id as string,
    firmId: row.firm_id as string,
    subscriptionId: row.subscription_id as string,
    amount: Number(row.amount),
    paymentMethod: row.payment_method as string,
    receiptUrl: (row.receipt_url as string | null) ?? undefined,
    proofOfPaymentUrl: (row.proof_of_payment_url as string | null) ?? (row.receipt_url as string | null) ?? undefined,
    status: row.status as PaymentRecord['status'],
    approvedAt: (row.approved_at as string | null) ?? undefined,
    rejectionReason: (row.rejection_reason as string | null) ?? undefined,
    createdAt: row.created_at as string
  };
}

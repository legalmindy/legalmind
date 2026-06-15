import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import type { FirmSubscription, SubscriptionPlanId, SubscriptionRequest } from '../types/app';

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
  plan: SubscriptionPlanId;
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

  const requestId = crypto.randomUUID();
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

  const { data, error } = await supabase
    .from('subscription_requests')
    .insert({
      id: requestId,
      firm_id: firmId,
      submitted_by: authData.user.id,
      plan: input.plan,
      amount_yer: input.amountYer,
      transfer_reference: input.transferReference.trim(),
      receipt_path: path,
      receipt_url: urlData.publicUrl,
      status: 'pending'
    })
    .select('*')
    .single();
  throwIfSupabaseError(error);
  return mapDbSubscriptionRequest(data);
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
    reviewedAt: (row.reviewed_at as string | null) ?? undefined
  };
}

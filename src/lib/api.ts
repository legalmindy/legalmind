import { supabase } from './supabaseClient';
import { resolveAuthUserId } from './authSession';
import {
  mapDbCase,
  mapDbClient,
  mapDbDocument,
  mapDbEmployee,
  mapDbFirm,
  mapDbInvitation,
  mapDbNotification,
  mapDbSession
} from './mappers';
import { decryptFileBlob, encryptFileBlob, isSensitiveDocument } from './fileEncryption';
import { sanitizeFileName, validateFile } from './fileValidation';
import { logError } from './errorLogger';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import { formatInvitationError, mapRpcInvitationRow } from './invitationErrors';
import { sanitizeHtml } from './sanitizeHtml';
import type {
  CaseRecord,
  Client,
  DocumentItem,
  Employee,
  Expense,
  Invitation,
  Lawyer,
  NotificationItem,
  Office,
  SessionItem,
  UserRole
} from '../types/app';
import type {
  DbCase,
  DbClient,
  DbDocument,
  DbEmployee,
  DbFirm,
  DbInvitation,
  DbNotification,
  DbSession,
  PaginatedResult,
  PaginationParams
} from '../types/database';

function cleanText(value: string | null | undefined, maxLength = 500): string {
  if (!value) return '';
  return value.trim().replace(/\0/g, '').slice(0, maxLength);
}

function maybeCleanText(value: string | null | undefined, maxLength = 500): string | null {
  if (!value) return null;
  return value.trim().replace(/\0/g, '').slice(0, maxLength) || null;
}

const DEFAULT_PAGE_SIZE = 20;
const ADMIN_ROLES: UserRole[] = ['super_admin', 'admin', 'firm_manager'];
/** lawyers.employee_id → employees.id (not lawyers.updated_by → employees.id) */
const LAWYERS_EMPLOYEE_FK = 'lawyers_employee_id_fkey';

// ─── Firm ID cache ─────────────────────────────────────────────────────────
// Caches firm_id per auth user-id to avoid 2+ DB round-trips on every API call.
// Cleared on sign-out via clearFirmIdCache() (called from auth.ts).
const firmIdCache = new Map<string, string>();

export function clearFirmIdCache(): void {
  firmIdCache.clear();
}

export async function getCurrentFirmId(): Promise<string> {
  const userId = await resolveAuthUserId();
  if (!userId) throw new Error('غير مصرح');

  const cached = firmIdCache.get(userId);
  if (cached) return cached;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('firm_id')
    .eq('id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!profileError && profile?.firm_id) {
    firmIdCache.set(userId, profile.firm_id as string);
    return profile.firm_id as string;
  }

  const { data: employee, error: employeeError } = await supabase
    .from('employees')
    .select('firm_id')
    .eq('auth_uid', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!employeeError && employee?.firm_id) {
    firmIdCache.set(userId, employee.firm_id as string);
    return employee.firm_id as string;
  }

  throw new Error('لم يتم العثور على المكتب');
}

export function isOfficeAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

// ─── Office ────────────────────────────────────────────────────
export async function fetchOffice(): Promise<Office> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('firms')
    .select('id, name, license_no, plan, firm_code, subscription_status, subscription_plan, subscription_expires_at, is_locked, reminders_enabled, whatsapp_reports_enabled, sms_reports_enabled, hide_financials_from_trainees')
    .eq('id', firmId)
    .single();
  if (error) throw error;
  return mapDbFirm(data as DbFirm);
}

export async function updateOffice(payload: Office): Promise<Office> {
  const { data, error } = await supabase
    .from('firms')
    .update({ name: payload.name, license_no: payload.licenseNo || null })
    .eq('id', payload.id)
    .select()
    .single();
  if (error) throw error;
  return mapDbFirm(data as DbFirm);
}

function buildPaginated<T>(data: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

const MAX_FETCH_ALL_PAGE_SIZE = 500;

/** Strip PostgREST filter metacharacters from user search input. */
function sanitizeSearchFilter(value: string): string {
  return value.trim().replace(/[%_,().\\]/g, '').slice(0, 100);
}

async function fetchAllPaginated<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PaginatedResult<T>>
): Promise<T[]> {
  const pageSize = MAX_FETCH_ALL_PAGE_SIZE;
  let page = 1;
  const all: T[] = [];
  let totalPages = 1;

  while (page <= totalPages) {
    const result = await fetchPage(page, pageSize);
    all.push(...result.data);
    totalPages = result.totalPages;
    page += 1;
  }

  return all;
}

// ─── Clients ──────────────────────────────────────────────────
export async function fetchClients(params: PaginationParams = {}): Promise<PaginatedResult<Client>> {
  const firmId = await getCurrentFirmId();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('clients')
    .select('*', { count: 'exact' })
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.search) {
    const q = sanitizeSearchFilter(params.search);
    if (q) {
      query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return buildPaginated((data as DbClient[]).map(mapDbClient), count ?? 0, page, pageSize);
}

export async function fetchAllClients(): Promise<Client[]> {
  return fetchAllPaginated((page, pageSize) => fetchClients({ page, pageSize }));
}

export async function createClient(payload: Omit<Client, 'id' | 'casesCount' | 'createdAt'>): Promise<Client> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('clients')
    .insert({
      firm_id: firmId,
      name: cleanText(payload.name, 200),
      phone: payload.phone || null,
      email: payload.email ? cleanText(payload.email, 120) : null,
      address: payload.address ? cleanText(payload.address, 300) : null,
      type: payload.type,
      cases_count: 0
    })
    .select()
    .single();
  if (error) throw error;
  return mapDbClient(data as DbClient);
}

export async function updateClientRecord(payload: Client): Promise<Client> {
  const firmId = await getCurrentFirmId();
  const { id, casesCount: _cc, createdAt: _ca, ...fields } = payload;
  const { data, error } = await supabase
    .from('clients')
    .update({
      name: cleanText(fields.name, 200),
      phone: fields.phone || null,
      email: fields.email ? cleanText(fields.email, 120) : null,
      address: fields.address ? cleanText(fields.address, 300) : null,
      type: fields.type
    })
    .eq('id', id)
    .eq('firm_id', firmId)
    .select()
    .single();
  if (error) throw error;
  return mapDbClient(data as DbClient);
}

export async function softDeleteClient(clientId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_client', { p_client_id: clientId });
  if (!error) return;

  if (/not_authorized/i.test(error.message)) {
    throw new Error('غير مصرح — لا تملك صلاحية حذف العملاء.');
  }
  if (/subscription_inactive/i.test(error.message)) {
    throw new Error('انتهى اشتراك المكتب — جدّد الاشتراك ثم أعد المحاولة.');
  }
  if (/client_has_active_cases/i.test(error.message)) {
    throw new Error('لا يمكن حذف العميل لأنه مرتبط بقضية حالية.');
  }
  if (/not_found/i.test(error.message)) {
    throw new Error('العميل غير موجود أو تم حذفه مسبقاً.');
  }
  if (/Could not find the function|42883|PGRST202/i.test(error.message)) {
    const firmId = await getCurrentFirmId();
    const { error: patchError } = await supabase
      .from('clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', clientId)
      .eq('firm_id', firmId);
    if (patchError) throw patchError;
    return;
  }
  throw error;
}

// ─── Cases ────────────────────────────────────────────────────
const CASE_SELECT =
  '*, clients(name), assigned_lawyer:lawyers(id, employee:employees!lawyers_employee_id_fkey(full_name))';

export async function fetchCases(params: PaginationParams = {}): Promise<PaginatedResult<CaseRecord>> {
  const firmId = await getCurrentFirmId();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('cases')
    .select(CASE_SELECT, { count: 'exact' })
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .neq('status', 'archived')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.search) {
    const q = sanitizeSearchFilter(params.search);
    if (q) {
      query = query.or(`title.ilike.%${q}%,court_case_number.ilike.%${q}%`);
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return buildPaginated((data as DbCase[]).map(mapDbCase), count ?? 0, page, pageSize);
}

export async function fetchAllCases(): Promise<CaseRecord[]> {
  return fetchAllPaginated((page, pageSize) => fetchCases({ page, pageSize }));
}

export async function fetchArchivedCases(): Promise<CaseRecord[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('cases')
    .select(CASE_SELECT)
    .eq('firm_id', firmId)
    .in('status', ['archived', 'closed'])
    .is('deleted_at', null)
    .order('archive_date', { ascending: false });
  if (error) throw error;
  return (data as DbCase[]).map(mapDbCase);
}

export async function fetchCaseById(caseId: string): Promise<CaseRecord | null> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('cases')
    .select(CASE_SELECT)
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .maybeSingle();
  throwIfSupabaseError(error);
  if (!data) return null;
  return mapDbCase(data as DbCase);
}

export async function createCase(
  payload: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted' | 'remaining_amount'>
): Promise<CaseRecord> {
  const firmId = await getCurrentFirmId();

  const { data: clientRow, error: clientError } = await supabase
    .from('clients')
    .select('id')
    .eq('id', payload.clientId)
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .maybeSingle();
  throwIfSupabaseError(clientError);
  if (!clientRow) {
    throw new Error('الموكل المختار غير مسجّل في النظام — أضف الموكل من صفحة العملاء أولاً.');
  }

  const lawyerId = payload.lawyerId?.trim() ? payload.lawyerId.trim() : null;
  if (lawyerId) {
    const lawyerValid = await isActiveFirmLawyer(firmId, lawyerId);
    if (!lawyerValid) {
      throw new Error('المحامي المختار غير مسجّل في النظام — اختر محامياً من القائمة أو اترك الحقل فارغاً.');
    }
  }

  const { data, error } = await supabase
    .from('cases')
    .insert({
      firm_id: firmId,
      client_id: payload.clientId,
      assigned_lawyer_id: lawyerId,
      court_case_number: maybeCleanText(payload.court_case_number || payload.caseNo, 100),
      title: cleanText(payload.title, 300),
      case_type: cleanText(payload.case_type, 100),
      case_stage: cleanText(payload.case_stage, 100),
      category: cleanText(payload.category, 100),
      court: cleanText(payload.court, 200),
      description: maybeCleanText(payload.description, 2000),
      total_amount: Number(payload.total_amount) || 0,
      paid_amount: Number(payload.paid_amount) || 0,
      contract_currency: payload.contract_currency ?? 'YER',
      contract_date: payload.contract_date || null,
      status: payload.status || 'active',
      notes: maybeCleanText(payload.notes, 1000)
    })
    .select(CASE_SELECT)
    .single();
  throwIfSupabaseError(error);
  return mapDbCase(data as DbCase);
}

export async function updateCaseRecord(payload: CaseRecord): Promise<CaseRecord> {
  const firmId = await getCurrentFirmId();
  const { id, clientName: _cn, dateStarted: _ds, remaining_amount: _ra, caseNo: _cno, lawyerId, ...fields } = payload;
  const { data, error } = await supabase
    .from('cases')
    .update({
      client_id: fields.clientId,
      assigned_lawyer_id: lawyerId || null,
      court_case_number: maybeCleanText(fields.court_case_number, 100),
      title: cleanText(fields.title, 300),
      case_type: cleanText(fields.case_type, 100),
      case_stage: cleanText(fields.case_stage, 100),
      category: cleanText(fields.category, 100),
      court: cleanText(fields.court, 200),
      description: maybeCleanText(fields.description, 2000),
      total_amount: fields.total_amount,
      paid_amount: fields.paid_amount,
      contract_currency: fields.contract_currency ?? 'YER',
      contract_date: fields.contract_date || null,
      status: fields.status,
      notes: maybeCleanText(fields.notes, 1000)
    })
    .eq('id', id)
    .eq('firm_id', firmId)
    .select(CASE_SELECT)
    .single();
  if (error) throw error;
  return mapDbCase(data as DbCase);
}

export async function restoreCaseRecord(caseId: string): Promise<CaseRecord> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('cases')
    .update({ status: 'active', archive_date: null })
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .select(CASE_SELECT)
    .single();
  if (error) throw error;
  return mapDbCase(data as DbCase);
}

export async function archiveCaseRecord(caseId: string, notes?: string): Promise<CaseRecord> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('cases')
    .update({
      status: 'archived',
      archive_date: new Date().toISOString(),
      notes: notes?.trim() || null
    })
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .select(CASE_SELECT)
    .single();
  if (error) throw error;
  return mapDbCase(data as DbCase);
}

export async function deleteCaseRecord(caseId: string): Promise<{ id: string }> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('cases')
    .update({ deleted_at: new Date().toISOString(), status: 'closed' })
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}

// ─── Sessions ─────────────────────────────────────────────────
const SESSION_SELECT = '*, cases(title)';

export async function fetchSessions(): Promise<SessionItem[]> {
  // Single query using firm_id column (added in migration 034)
  // instead of a two-hop case-id harvest + large IN() list.
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .order('session_date', { ascending: true });
  if (error) throw error;
  return (data as DbSession[]).map(mapDbSession);
}

export async function fetchUpcomingSessions(limit = 8): Promise<SessionItem[]> {
  const firmId = await getCurrentFirmId();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('firm_id', firmId)
    .eq('status', 'مجدولة')
    .gte('session_date', today)
    .is('deleted_at', null)
    .order('session_date', { ascending: true })
    .order('session_time', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data as DbSession[]).map(mapDbSession);
}

export async function createSession(payload: Omit<SessionItem, 'id' | 'caseTitle'>): Promise<SessionItem> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      case_id: payload.caseId,
      court: cleanText(payload.court, 200),
      session_date: payload.date,
      session_time: payload.time,
      status: payload.status,
      session_type: maybeCleanText(payload.type, 100),
      notes: maybeCleanText(payload.notes, 1000),
      judge_name: maybeCleanText(payload.judgeName, 200),
      next_session_date: payload.nextSessionDate || null,
      session_outcome: payload.sessionOutcome ? sanitizeHtml(payload.sessionOutcome).slice(0, 8000) : null
    })
    .select(SESSION_SELECT)
    .single();
  if (error) throw error;
  return mapDbSession(data as DbSession);
}

export async function updateSessionRecord(payload: SessionItem): Promise<SessionItem> {
  const firmId = await getCurrentFirmId();
  const { id, caseTitle: _ct, ...fields } = payload;
  const { data, error } = await supabase
    .from('sessions')
    .update({
      case_id: fields.caseId,
      court: cleanText(fields.court, 200),
      session_date: fields.date,
      session_time: fields.time,
      status: fields.status,
      session_type: maybeCleanText(fields.type, 100),
      notes: maybeCleanText(fields.notes, 1000),
      judge_name: maybeCleanText(fields.judgeName, 200),
      next_session_date: fields.nextSessionDate || null,
      session_outcome: fields.sessionOutcome ? sanitizeHtml(fields.sessionOutcome).slice(0, 8000) : null
    })
    .eq('id', id)
    .eq('firm_id', firmId)
    .select(SESSION_SELECT)
    .single();
  if (error) throw error;
  return mapDbSession(data as DbSession);
}

export async function deleteSessionRecord(sessionId: string): Promise<{ id: string }> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('sessions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('firm_id', firmId)
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}

// ─── Documents ────────────────────────────────────────────────
const DOC_SELECT = '*, cases(title)';

export async function fetchDocuments(): Promise<DocumentItem[]> {
  // Direct firm_id query via the cases join to avoid the two-hop
  // case-id harvest + large IN() list that breaks at scale.
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('documents')
    .select(DOC_SELECT)
    .eq('cases.firm_id', firmId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data as DbDocument[]).map(mapDbDocument);
}

export async function uploadDocumentFile(
  file: File,
  caseId: string,
  title?: string,
  category?: string
): Promise<DocumentItem> {
  const validation = validateFile(file);
  if (!validation.valid || !validation.documentType) {
    throw new Error(validation.error ?? 'ملف غير صالح');
  }

  const safeName = sanitizeFileName(file.name);
  const path = `${caseId}/${Date.now()}-${safeName}`;

  const docTitle = cleanText(title || safeName, 300) || safeName;
  const docCategory = cleanText(category || 'مستند قانوني', 100);
  const shouldEncrypt = isSensitiveDocument(docTitle, docCategory);

  let uploadBody: Blob | File = file;
  if (shouldEncrypt) {
    uploadBody = await encryptFileBlob(file);
  }

  const { error: storageError } = await supabase.storage
    .from('case-documents')
    .upload(path, uploadBody, { cacheControl: '3600', upsert: false, contentType: shouldEncrypt ? 'application/octet-stream' : file.type });

  if (storageError) {
    void logError(storageError.message, { caseId, fileName: safeName });
    throw storageError;
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(path, 3600);

  if (signedError) throw signedError;

  const { data, error } = await supabase
    .from('documents')
    .insert({
      case_id: caseId,
      title: docTitle,
      category: docCategory,
      file_type: validation.documentType,
      file_size: file.size,
      storage_path: path,
      url: signedData.signedUrl,
      is_encrypted: shouldEncrypt
    })
    .select(DOC_SELECT)
    .single();

  if (error) throw error;
  return mapDbDocument(data as DbDocument);
}

export async function getDocumentDownloadUrl(documentId: string): Promise<string> {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('storage_path, is_encrypted')
    .eq('id', documentId)
    .single();
  if (error || !doc) throw new Error('المستند غير موجود');

  const { data: signed, error: signedError } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(doc.storage_path as string, 300);

  if (signedError) throw signedError;
  return signed.signedUrl;
}

/** Fetch document blob, decrypting sensitive files when needed. */
export async function getDocumentBlob(documentId: string): Promise<Blob> {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('storage_path, is_encrypted')
    .eq('id', documentId)
    .single();
  if (error || !doc) throw new Error('المستند غير موجود');

  const { data: signed, error: signedError } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(doc.storage_path as string, 300);
  if (signedError) throw signedError;

  const response = await fetch(signed.signedUrl);
  if (!response.ok) throw new Error('فشل تحميل المستند');
  let blob = await response.blob();

  if (doc.is_encrypted) {
    blob = await decryptFileBlob(blob);
  }

  return blob;
}

// ─── Employees ────────────────────────────────────────────────
export async function fetchEmployees(): Promise<Employee[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('employees')
    .select('*, firm_roles(name, slug)')
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as DbEmployee[]).map(mapDbEmployee);
}

export async function createEmployee(payload: Omit<Employee, 'id' | 'created_at'>): Promise<Employee> {
  const firmId = await getCurrentFirmId();
  const sanitized = {
    ...payload,
    full_name: cleanText(payload.full_name, 200),
    email: maybeCleanText(payload.email, 120) ?? '',
    phone: maybeCleanText(payload.phone, 30) ?? '',
    firm_id: firmId
  };
  const { data, error } = await supabase
    .from('employees')
    .insert(sanitized)
    .select()
    .single();
  if (error) throw error;
  return mapDbEmployee(data as DbEmployee);
}

export interface InviteUserPayload {
  email: string;
  firmRoleId: string;
  fullName: string;
  phone?: string;
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('firm_id', firmId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as DbInvitation[]).map(mapDbInvitation);
}

export async function inviteOfficeUser(payload: InviteUserPayload): Promise<Invitation> {
  const { data, error } = await supabase.rpc('create_office_invitation', {
    invite_email: payload.email.trim(),
    invite_role: null,
    app_origin: window.location.origin,
    invite_full_name: payload.fullName.trim(),
    invite_phone: payload.phone?.trim() || null,
    invite_firm_role_id: payload.firmRoleId
  });
  if (error) throw new Error(formatInvitationError(error));

  const created = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!created?.id) throw new Error('فشل إنشاء الدعوة.');

  const firmId = await getCurrentFirmId().catch(() => undefined);
  return mapRpcInvitationRow(created, {
    fullName: payload.fullName,
    phone: payload.phone,
    firmId
  });
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  const { data, error } = await supabase.rpc('cancel_office_invitation', { invitation_id: invitationId });
  if (error) throw new Error(formatInvitationError(error));

  const row = (Array.isArray(data) ? data[0] : data) as { status?: string } | null;
  if (!row || row.status !== 'cancelled') {
    throw new Error('لم يتم إلغاء الدعوة. شغّل migration 033 في Supabase SQL Editor.');
  }
}

export async function resendInvitation(invitationId: string): Promise<Invitation> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('resend_office_invitation', {
    invitation_id: invitationId,
    app_origin: window.location.origin
  });
  if (rpcError) throw new Error(formatInvitationError(rpcError));
  const resent = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as Record<string, unknown> | null;
  if (!resent?.id) throw new Error('فشل إعادة إرسال الدعوة.');
  const firmId = await getCurrentFirmId().catch(() => undefined);
  return mapRpcInvitationRow(resent, { firmId });
}

export const revokeInvitation = cancelInvitation;

export async function updateEmployeeRecord(payload: Employee): Promise<Employee> {
  const firmId = await getCurrentFirmId();
  const { id, created_at: _ca, ...changes } = payload;
  const { data, error } = await supabase
    .from('employees')
    .update(changes)
    .eq('id', id)
    .eq('firm_id', firmId)
    .select()
    .single();
  if (error) throw error;
  return mapDbEmployee(data as DbEmployee);
}

export async function toggleEmployeeStatusRecord(
  employeeId: string,
  nextStatus: Employee['status']
): Promise<Employee> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('employees')
    .update({ status: nextStatus })
    .eq('id', employeeId)
    .eq('firm_id', firmId)
    .select()
    .single();
  if (error) throw error;
  return mapDbEmployee(data as DbEmployee);
}

export async function deleteEmployeeRecord(employeeId: string): Promise<{ id: string }> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('employees')
    .update({ deleted_at: new Date().toISOString(), status: 'disabled' })
    .eq('id', employeeId)
    .eq('firm_id', firmId)
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}

// ─── Lawyers ──────────────────────────────────────────────────
async function isActiveFirmLawyer(firmId: string, lawyerId: string): Promise<boolean> {
  const { data: lawyerRow, error: lawyerError } = await supabase
    .from('lawyers')
    .select('id, employee_id')
    .eq('id', lawyerId)
    .maybeSingle();
  throwIfSupabaseError(lawyerError);
  if (!lawyerRow?.employee_id) return false;

  const { data: employeeRow, error: employeeError } = await supabase
    .from('employees')
    .select('id')
    .eq('id', lawyerRow.employee_id)
    .eq('firm_id', firmId)
    .eq('role', 'lawyer')
    .is('deleted_at', null)
    .eq('status', 'active')
    .maybeSingle();
  throwIfSupabaseError(employeeError);
  return Boolean(employeeRow);
}

type EmployeeLawyerJoinRow = {
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  lawyers:
    | {
        id: string;
        specialization: string | null;
        success_rate: number | null;
        attendance_rate: number | null;
        total_cases: number | null;
        won_cases: number | null;
        attended_sessions: number | null;
        missed_sessions: number | null;
      }
    | {
        id: string;
        specialization: string | null;
        success_rate: number | null;
        attendance_rate: number | null;
        total_cases: number | null;
        won_cases: number | null;
        attended_sessions: number | null;
        missed_sessions: number | null;
      }[]
    | null;
};

function mapEmployeeLawyerRow(row: EmployeeLawyerJoinRow): Lawyer | null {
  const lawyerRow = Array.isArray(row.lawyers) ? row.lawyers[0] : row.lawyers;
  if (!lawyerRow) return null;
  return {
    id: lawyerRow.id,
    name: row.full_name,
    role: row.role,
    email: row.email ?? '',
    phone: row.phone ?? '',
    specialization: lawyerRow.specialization ?? 'عام',
    success_rate: lawyerRow.success_rate ?? undefined,
    attendance_rate: lawyerRow.attendance_rate ?? undefined,
    total_cases: lawyerRow.total_cases ?? undefined,
    won_cases: lawyerRow.won_cases ?? undefined,
    attended_sessions: lawyerRow.attended_sessions ?? undefined,
    missed_sessions: lawyerRow.missed_sessions ?? undefined
  };
}

export async function fetchLawyers(): Promise<Lawyer[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('employees')
    .select(`
      full_name,
      email,
      phone,
      role,
      lawyers!${LAWYERS_EMPLOYEE_FK} (
        id,
        specialization,
        success_rate,
        attendance_rate,
        total_cases,
        won_cases,
        attended_sessions,
        missed_sessions
      )
    `)
    .eq('firm_id', firmId)
    .eq('role', 'lawyer')
    .is('deleted_at', null)
    .eq('status', 'active');
  throwIfSupabaseError(error);
  return (data as EmployeeLawyerJoinRow[])
    .map(mapEmployeeLawyerRow)
    .filter((lawyer): lawyer is Lawyer => lawyer !== null);
}

export async function assignCaseLawyer(caseId: string, lawyerId: string | null): Promise<CaseRecord> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('cases')
    .update({ assigned_lawyer_id: lawyerId })
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .select(CASE_SELECT)
    .single();
  if (error) throw error;
  return mapDbCase(data as DbCase);
}

// ─── Notifications ────────────────────────────────────────────
export async function fetchNotifications(): Promise<NotificationItem[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as DbNotification[]).map(mapDbNotification);
}

export async function createNotification(
  payload: Omit<NotificationItem, 'id' | 'read' | 'time'>
): Promise<NotificationItem> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      firm_id: firmId,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      read: false
    })
    .select()
    .single();
  if (error) throw error;
  return mapDbNotification(data as DbNotification);
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('firm_id', firmId)
    .select()
    .single();
  if (error) throw error;
  return mapDbNotification(data as DbNotification);
}

export async function markAllNotificationsRead(): Promise<void> {
  const firmId = await getCurrentFirmId();
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('firm_id', firmId)
    .eq('read', false);
  if (error) throw error;
}

// ─── RBAC helper ──────────────────────────────────────────────
export function checkRoleAccess(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}

// ─── Office Expenses ──────────────────────────────────────────────────────────

function mapDbExpense(row: Record<string, unknown>): Expense {
  return {
    id: row.id as string,
    title: row.title as string,
    amount: Number(row.amount),
    category: (row.category as string) ?? 'عام',
    expense_date: row.expense_date as string,
    notes: (row.notes as string | null) ?? undefined,
    createdAt: String(row.created_at ?? '').split('T')[0] ?? ''
  };
}

export async function fetchExpenses(): Promise<Expense[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('office_expenses')
    .select('id, title, amount, category, expense_date, notes, created_at')
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .order('expense_date', { ascending: false });
  throwIfSupabaseError(error);
  return (data as Record<string, unknown>[]).map(mapDbExpense);
}

export async function createExpense(payload: {
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  notes?: string;
}): Promise<Expense> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('office_expenses')
    .insert({
      firm_id: firmId,
      title: cleanText(payload.title),
      amount: payload.amount,
      category: payload.category,
      expense_date: payload.expense_date,
      notes: payload.notes?.trim() || null
    })
    .select('id, title, amount, category, expense_date, notes, created_at')
    .single();
  throwIfSupabaseError(error);
  return mapDbExpense(data as Record<string, unknown>);
}

export async function deleteExpense(id: string): Promise<void> {
  // Use SECURITY DEFINER RPC to bypass the RLS WITH CHECK restriction
  // that would otherwise reject the soft-delete (migration 040).
  const { error } = await supabase.rpc('delete_office_expense', { expense_id: id });
  if (error) {
    if (error.message.includes('NOT_FOUND') || error.message.includes('P0002')) {
      throw new Error('المصروف غير موجود أو تم حذفه مسبقاً.');
    }
    if (error.message.includes('FORBIDDEN')) {
      throw new Error('ليس لديك صلاحية حذف المصاريف.');
    }
    throw error;
  }
}

export function canManageOffice(userRole: UserRole): boolean {
  return isOfficeAdminRole(userRole);
}

export function canManageClients(userRole: UserRole): boolean {
  return isOfficeAdminRole(userRole) || userRole === 'assistant';
}

export function canManageCases(userRole: UserRole): boolean {
  return isOfficeAdminRole(userRole) || userRole === 'assistant' || userRole === 'lawyer';
}

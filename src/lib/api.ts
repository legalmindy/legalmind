import { supabase } from './supabaseClient';
import {
  mapDbCase,
  mapDbClient,
  mapDbDocument,
  mapDbEmployee,
  mapDbFirm,
  mapDbInvitation,
  mapDbLawyer,
  mapDbNotification,
  mapDbSession
} from './mappers';
import { sanitizeFileName, validateFile } from './fileValidation';
import { logError } from './errorLogger';
import type {
  CaseRecord,
  Client,
  DocumentItem,
  Employee,
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
  DbLawyer,
  DbNotification,
  DbSession,
  PaginatedResult,
  PaginationParams
} from '../types/database';

const DEFAULT_PAGE_SIZE = 20;
const ADMIN_ROLES: UserRole[] = ['super_admin', 'admin', 'firm_manager'];

async function getCurrentFirmId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('غير مصرح');

  const { data, error } = await supabase
    .from('employees')
    .select('firm_id')
    .eq('auth_uid', user.id)
    .single();

  if (error || !data?.firm_id) throw new Error('لم يتم العثور على المكتب');
  return data.firm_id as string;
}

export function isOfficeAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

// ─── Office ────────────────────────────────────────────────────
export async function fetchOffice(): Promise<Office> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('firms')
    .select('id, name, license_no, plan, firm_code')
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
    query = query.or(`name.ilike.%${params.search}%,phone.ilike.%${params.search}%,email.ilike.%${params.search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return buildPaginated((data as DbClient[]).map(mapDbClient), count ?? 0, page, pageSize);
}

export async function fetchAllClients(): Promise<Client[]> {
  const result = await fetchClients({ pageSize: 1000 });
  return result.data;
}

export async function createClient(payload: Omit<Client, 'id' | 'casesCount' | 'createdAt'>): Promise<Client> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('clients')
    .insert({
      firm_id: firmId,
      name: payload.name,
      phone: payload.phone || null,
      email: payload.email || null,
      address: payload.address || null,
      type: payload.type,
      cases_count: 0
    })
    .select()
    .single();
  if (error) throw error;
  return mapDbClient(data as DbClient);
}

export async function updateClientRecord(payload: Client): Promise<Client> {
  const { id, casesCount: _cc, createdAt: _ca, ...fields } = payload;
  const { data, error } = await supabase
    .from('clients')
    .update({
      name: fields.name,
      phone: fields.phone || null,
      email: fields.email || null,
      address: fields.address || null,
      type: fields.type
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapDbClient(data as DbClient);
}

export async function softDeleteClient(clientId: string): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', clientId);
  if (error) throw error;
}

// ─── Cases ────────────────────────────────────────────────────
const CASE_SELECT = '*, clients(name)';

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
    query = query.or(`title.ilike.%${params.search}%,court_case_number.ilike.%${params.search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return buildPaginated((data as DbCase[]).map(mapDbCase), count ?? 0, page, pageSize);
}

export async function fetchAllCases(): Promise<CaseRecord[]> {
  const result = await fetchCases({ pageSize: 1000 });
  return result.data;
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

export async function createCase(
  payload: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted' | 'remaining_amount'>
): Promise<CaseRecord> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('cases')
    .insert({
      firm_id: firmId,
      client_id: payload.clientId,
      assigned_lawyer_id: payload.lawyerId || null,
      court_case_number: payload.court_case_number || payload.caseNo,
      title: payload.title,
      case_type: payload.case_type,
      case_stage: payload.case_stage,
      category: payload.category,
      court: payload.court,
      description: payload.description,
      total_amount: payload.total_amount,
      paid_amount: payload.paid_amount,
      status: payload.status,
      notes: payload.notes ?? null
    })
    .select(CASE_SELECT)
    .single();
  if (error) throw error;
  return mapDbCase(data as DbCase);
}

export async function updateCaseRecord(payload: CaseRecord): Promise<CaseRecord> {
  const { id, clientName: _cn, dateStarted: _ds, remaining_amount: _ra, caseNo: _cno, lawyerId, ...fields } = payload;
  const { data, error } = await supabase
    .from('cases')
    .update({
      client_id: fields.clientId,
      assigned_lawyer_id: lawyerId || null,
      court_case_number: fields.court_case_number,
      title: fields.title,
      case_type: fields.case_type,
      case_stage: fields.case_stage,
      category: fields.category,
      court: fields.court,
      description: fields.description,
      total_amount: fields.total_amount,
      paid_amount: fields.paid_amount,
      status: fields.status,
      notes: fields.notes ?? null
    })
    .eq('id', id)
    .select(CASE_SELECT)
    .single();
  if (error) throw error;
  return mapDbCase(data as DbCase);
}

export async function restoreCaseRecord(caseId: string): Promise<CaseRecord> {
  const { data, error } = await supabase
    .from('cases')
    .update({ status: 'active', archive_date: null })
    .eq('id', caseId)
    .select(CASE_SELECT)
    .single();
  if (error) throw error;
  return mapDbCase(data as DbCase);
}

export async function deleteCaseRecord(caseId: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('cases')
    .update({ deleted_at: new Date().toISOString(), status: 'closed' })
    .eq('id', caseId)
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}

// ─── Sessions ─────────────────────────────────────────────────
const SESSION_SELECT = '*, cases(title)';

export async function fetchSessions(): Promise<SessionItem[]> {
  const { data: caseIds } = await supabase
    .from('cases')
    .select('id');

  if (!caseIds?.length) return [];

  const ids = caseIds.map((c: { id: string }) => c.id);
  const { data, error } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .in('case_id', ids)
    .is('deleted_at', null)
    .order('session_date', { ascending: true });
  if (error) throw error;
  return (data as DbSession[]).map(mapDbSession);
}

export async function createSession(payload: Omit<SessionItem, 'id' | 'caseTitle'>): Promise<SessionItem> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      case_id: payload.caseId,
      court: payload.court,
      session_date: payload.date,
      session_time: payload.time,
      status: payload.status,
      session_type: payload.type || null,
      notes: payload.notes || null
    })
    .select(SESSION_SELECT)
    .single();
  if (error) throw error;
  return mapDbSession(data as DbSession);
}

export async function updateSessionRecord(payload: SessionItem): Promise<SessionItem> {
  const { id, caseTitle: _ct, ...fields } = payload;
  const { data, error } = await supabase
    .from('sessions')
    .update({
      case_id: fields.caseId,
      court: fields.court,
      session_date: fields.date,
      session_time: fields.time,
      status: fields.status,
      session_type: fields.type || null,
      notes: fields.notes || null
    })
    .eq('id', id)
    .select(SESSION_SELECT)
    .single();
  if (error) throw error;
  return mapDbSession(data as DbSession);
}

export async function deleteSessionRecord(sessionId: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('sessions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}

// ─── Documents ────────────────────────────────────────────────
const DOC_SELECT = '*, cases(title)';

export async function fetchDocuments(): Promise<DocumentItem[]> {
  const { data: caseIds } = await supabase.from('cases').select('id');
  if (!caseIds?.length) return [];

  const ids = caseIds.map((c: { id: string }) => c.id);
  const { data, error } = await supabase
    .from('documents')
    .select(DOC_SELECT)
    .in('case_id', ids)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data as DbDocument[]).map(mapDbDocument);
}

export async function uploadDocumentFile(file: File, caseId: string): Promise<DocumentItem> {
  const validation = validateFile(file);
  if (!validation.valid || !validation.documentType) {
    throw new Error(validation.error ?? 'ملف غير صالح');
  }

  const safeName = sanitizeFileName(file.name);
  const path = `${caseId}/${Date.now()}-${safeName}`;

  const { error: storageError } = await supabase.storage
    .from('case-documents')
    .upload(path, file, { cacheControl: '3600', upsert: false });

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
      title: safeName,
      category: 'مستند قانوني',
      file_type: validation.documentType,
      file_size: file.size,
      storage_path: path,
      url: signedData.signedUrl
    })
    .select(DOC_SELECT)
    .single();

  if (error) throw error;
  return mapDbDocument(data as DbDocument);
}

export async function getDocumentDownloadUrl(documentId: string): Promise<string> {
  const { data: doc, error } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('id', documentId)
    .single();
  if (error || !doc) throw new Error('المستند غير موجود');

  const { data: signed, error: signedError } = await supabase.storage
    .from('case-documents')
    .createSignedUrl(doc.storage_path as string, 300);

  if (signedError) throw signedError;
  return signed.signedUrl;
}

// ─── Employees ────────────────────────────────────────────────
export async function fetchEmployees(): Promise<Employee[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as DbEmployee[]).map(mapDbEmployee);
}

export async function createEmployee(payload: Omit<Employee, 'id' | 'created_at'>): Promise<Employee> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('employees')
    .insert({ ...payload, firm_id: firmId })
    .select()
    .single();
  if (error) throw error;
  return mapDbEmployee(data as DbEmployee);
}

export interface InviteUserPayload {
  email: string;
  role: Extract<UserRole, 'lawyer' | 'assistant'>;
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as DbInvitation[]).map(mapDbInvitation);
}

export async function inviteOfficeUser(payload: InviteUserPayload): Promise<Invitation> {
  const { data, error } = await supabase.rpc('create_office_invitation', {
    invite_email: payload.email,
    invite_role: payload.role,
    app_origin: window.location.origin
  });
  if (error) throw error;
  const created = Array.isArray(data) ? data[0] : data;
  if (!created?.id) throw new Error('فشل إنشاء الدعوة.');

  const { data: invitation, error: fetchError } = await supabase
    .from('invitations')
    .select('*')
    .eq('id', created.id as string)
    .single();
  if (fetchError) throw fetchError;
  return mapDbInvitation(invitation as DbInvitation);
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_office_invitation', { invitation_id: invitationId });
  if (error) throw error;
}

export async function resendInvitation(invitationId: string): Promise<Invitation> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('resend_office_invitation', {
    invitation_id: invitationId,
    app_origin: window.location.origin
  });
  if (rpcError) throw rpcError;
  const resent = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!resent?.id) throw new Error('فشل إعادة إرسال الدعوة.');
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('id', invitationId)
    .single();
  if (error) throw error;
  return mapDbInvitation(data as DbInvitation);
}

export const revokeInvitation = cancelInvitation;

export async function updateEmployeeRecord(payload: Employee): Promise<Employee> {
  const { id, created_at: _ca, ...changes } = payload;
  const { data, error } = await supabase.from('employees').update(changes).eq('id', id).select().single();
  if (error) throw error;
  return mapDbEmployee(data as DbEmployee);
}

export async function toggleEmployeeStatusRecord(
  employeeId: string,
  nextStatus: Employee['status']
): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .update({ status: nextStatus })
    .eq('id', employeeId)
    .select()
    .single();
  if (error) throw error;
  return mapDbEmployee(data as DbEmployee);
}

export async function deleteEmployeeRecord(employeeId: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from('employees')
    .update({ deleted_at: new Date().toISOString(), status: 'disabled' })
    .eq('id', employeeId)
    .select('id')
    .single();
  if (error) throw error;
  return data as { id: string };
}

// ─── Lawyers ──────────────────────────────────────────────────
export async function fetchLawyers(): Promise<Lawyer[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('lawyers')
    .select('*, employees!inner(*)')
    .eq('employees.firm_id', firmId);
  if (error) throw error;
  return (data as DbLawyer[]).map(mapDbLawyer);
}

export async function assignCaseLawyer(caseId: string, lawyerId: string | null): Promise<CaseRecord> {
  const { data, error } = await supabase
    .from('cases')
    .update({ assigned_lawyer_id: lawyerId })
    .eq('id', caseId)
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
  const { data, error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
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

export function canManageOffice(userRole: UserRole): boolean {
  return isOfficeAdminRole(userRole);
}

export function canManageClients(userRole: UserRole): boolean {
  return isOfficeAdminRole(userRole) || userRole === 'assistant';
}

export function canManageCases(userRole: UserRole): boolean {
  return isOfficeAdminRole(userRole) || userRole === 'assistant' || userRole === 'lawyer';
}

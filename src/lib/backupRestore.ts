import JSZip from 'jszip';
import { getCurrentFirmId } from './api';
import { backupLog } from './backupValidation';
import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

const CASE_TYPES = ['مدنية', 'تجارية', 'أحوال شخصية', 'عمالية', 'مستعجلة', 'جنائية'] as const;
const CASE_STAGES = ['ابتدائي مدني', 'ابتدائي شخصي', 'ابتدائي جنائي', 'استئناف', 'نقض'] as const;
const CASE_STATUSES = ['active', 'archived', 'closed'] as const;
const PAYMENT_METHODS = ['نقداً', 'تحويل بنكي', 'شيك', 'محفظة إلكترونية', 'أخرى'] as const;
const EMPLOYEE_ROLES = ['super_admin', 'admin', 'lawyer', 'assistant', 'firm_manager'] as const;
const EMPLOYEE_STATUSES = ['active', 'suspended', 'disabled', 'pending_approval'] as const;

const BATCH_SIZE = 80;

export interface RestoreResult {
  restored: string[];
  warnings: string[];
  documentFailures: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function asString(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  return String(value).trim();
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asUuid(value: unknown): string | null {
  const s = asString(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

function normalizePhone(value: unknown): string | null {
  const digits = asString(value).replace(/\D/g, '');
  if (!digits) return null;
  return /^[0-9]{9,15}$/.test(digits) ? digits : null;
}

function normalizeCaseType(value: unknown): (typeof CASE_TYPES)[number] {
  const s = asString(value, 'مدنية');
  return (CASE_TYPES as readonly string[]).includes(s) ? (s as (typeof CASE_TYPES)[number]) : 'مدنية';
}

function normalizeCaseStage(value: unknown): (typeof CASE_STAGES)[number] {
  const s = asString(value, 'ابتدائي مدني');
  return (CASE_STAGES as readonly string[]).includes(s) ? (s as (typeof CASE_STAGES)[number]) : 'ابتدائي مدني';
}

function normalizeCaseStatus(value: unknown): (typeof CASE_STATUSES)[number] {
  const s = asString(value, 'active');
  if ((CASE_STATUSES as readonly string[]).includes(s)) return s as (typeof CASE_STATUSES)[number];
  if (s === 'مؤرشفة' || s === 'archived') return 'archived';
  if (s === 'مغلقة' || s === 'closed') return 'closed';
  return 'active';
}

export function normalizePaymentMethod(value: unknown): (typeof PAYMENT_METHODS)[number] {
  const s = asString(value, 'نقداً');
  return (PAYMENT_METHODS as readonly string[]).includes(s)
    ? (s as (typeof PAYMENT_METHODS)[number])
    : 'نقداً';
}

function normalizeEmployeeRole(value: unknown): (typeof EMPLOYEE_ROLES)[number] {
  const s = asString(value, 'assistant');
  return (EMPLOYEE_ROLES as readonly string[]).includes(s)
    ? (s as (typeof EMPLOYEE_ROLES)[number])
    : 'assistant';
}

function normalizeEmployeeStatus(value: unknown): (typeof EMPLOYEE_STATUSES)[number] {
  const s = asString(value, 'active');
  return (EMPLOYEE_STATUSES as readonly string[]).includes(s)
    ? (s as (typeof EMPLOYEE_STATUSES)[number])
    : 'active';
}

function inferDocumentType(title: string, value: unknown): string {
  const allowed = ['pdf', 'docx', 'xlsx', 'jpg', 'png', 'webp'];
  const fromField = asString(value).toLowerCase();
  if (allowed.includes(fromField)) return fromField;
  const ext = title.split('.').pop()?.toLowerCase() ?? '';
  if (allowed.includes(ext)) return ext;
  return 'pdf';
}

async function loadJsonArray(zip: JSZip, path: string): Promise<Record<string, unknown>[]> {
  const file = zip.file(path);
  if (!file) return [];
  try {
    const parsed = JSON.parse(await file.async('string')) as unknown;
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

async function loadEntityRows(zip: JSZip, entity: string): Promise<Record<string, unknown>[]> {
  const raw = await loadJsonArray(zip, `data/raw/${entity}.json`);
  if (raw.length) return raw;
  return loadJsonArray(zip, `data/${entity}.json`);
}

function isRawClientRow(row: Record<string, unknown>): boolean {
  return 'firm_id' in row && 'name' in row;
}

function isRawCaseRow(row: Record<string, unknown>): boolean {
  return 'firm_id' in row && 'client_id' in row && 'court_case_number' in row;
}

function mapFirmRoleRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const name = asString(row.name);
  const slug = asString(row.slug);
  if (!id || !name || !slug) return null;
  return {
    id,
    firm_id: firmId,
    name,
    slug,
    is_template: Boolean(row.is_template),
    permissions: row.permissions ?? {},
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString()
  };
}

function mapEmployeeRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const fullName = asString(row.full_name ?? row.fullName);
  const email = asString(row.email);
  if (!id || fullName.length < 2 || !email) return null;

  return {
    id,
    firm_id: firmId,
    full_name: fullName,
    email,
    phone: normalizePhone(row.phone),
    role: normalizeEmployeeRole(row.role),
    status: normalizeEmployeeStatus(row.status),
    firm_role_id: asUuid(row.firm_role_id) ?? null,
    individual_permissions: row.individual_permissions ?? null,
    profile_image: asString(row.profile_image) || null,
    deleted_at: null
  };
}

function mapLawyerRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const employeeId = asUuid(row.employee_id);
  if (!id || !employeeId) return null;
  return {
    id,
    employee_id: employeeId,
    specialization: asString(row.specialization, 'عام'),
    success_rate: asNumber(row.success_rate),
    attendance_rate: asNumber(row.attendance_rate),
    total_cases: Math.max(0, asNumber(row.total_cases)),
    won_cases: Math.max(0, asNumber(row.won_cases)),
    attended_sessions: Math.max(0, asNumber(row.attended_sessions)),
    missed_sessions: Math.max(0, asNumber(row.missed_sessions))
  };
}

function mapClientRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const name = asString(row.name);
  if (!id || name.length < 2) return null;

  if (isRawClientRow(row)) {
    return {
      id,
      firm_id: firmId,
      name,
      phone: normalizePhone(row.phone),
      email: asString(row.email) || null,
      address: asString(row.address) || null,
      type: asString(row.type, 'فرد'),
      cases_count: Math.max(0, asNumber(row.cases_count)),
      created_at: row.created_at ?? new Date().toISOString(),
      deleted_at: null
    };
  }

  return {
    id,
    firm_id: firmId,
    name,
    phone: normalizePhone(row.phone),
    email: asString(row.email) || null,
    address: asString(row.address) || null,
    type: asString(row.type, 'فرد'),
    cases_count: Math.max(0, asNumber(row.cases_count)),
    created_at: row.created_at ?? new Date().toISOString(),
    deleted_at: null
  };
}

function mapCaseRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const clientId = asUuid(row.client_id ?? row.clientId);
  const title = asString(row.title);
  if (!id || !clientId || title.length < 2) return null;

  const assignedLawyerId = asUuid(row.assigned_lawyer_id);

  if (isRawCaseRow(row)) {
    const total = asNumber(row.total_amount);
    const paid = Math.min(asNumber(row.paid_amount), total);
    return {
      id,
      firm_id: firmId,
      client_id: clientId,
      assigned_lawyer_id: assignedLawyerId,
      court_case_number: asString(row.court_case_number, `CASE-${id.slice(0, 8)}`),
      title,
      case_type: normalizeCaseType(row.case_type),
      case_stage: normalizeCaseStage(row.case_stage),
      category: asString(row.category, 'تجاري'),
      court: asString(row.court),
      description: asString(row.description) || null,
      total_amount: total,
      paid_amount: paid,
      status: normalizeCaseStatus(row.status),
      contract_currency: asString(row.contract_currency, 'YER'),
      contract_date: row.contract_date ?? null,
      notes: asString(row.notes) || null,
      deleted_at: null
    };
  }

  const total = asNumber(row.total_fee ?? row.total_amount);
  const paid = Math.min(asNumber(row.paid_amount), total);
  const caseNumber = asString(row.case_number ?? row.court_case_number, `CASE-${id.slice(0, 8)}`);

  return {
    id,
    firm_id: firmId,
    client_id: clientId,
    assigned_lawyer_id: assignedLawyerId,
    court_case_number: caseNumber,
    title,
    case_type: normalizeCaseType(row.type ?? row.case_type),
    case_stage: normalizeCaseStage(row.stage ?? row.case_stage),
    category: asString(row.category, 'تجاري'),
    court: asString(row.court),
    description: asString(row.description) || null,
    total_amount: total,
    paid_amount: paid,
    status: normalizeCaseStatus(row.status),
    contract_currency: asString(row.contract_currency, 'YER'),
    contract_date: row.contract_date ?? row.date_started ?? null,
    notes: asString(row.notes) || null,
    deleted_at: null
  };
}

function mapSessionRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const caseId = asUuid(row.case_id ?? row.caseId);
  if (!id || !caseId) return null;

  if ('session_date' in row) {
    return {
      id,
      case_id: caseId,
      court: asString(row.court),
      session_date: asString(row.session_date).slice(0, 10),
      session_time: asString(row.session_time, '09:00:00'),
      status: asString(row.status, 'مجدولة'),
      session_type: asString(row.session_type) || null,
      judge_name: asString(row.judge_name) || null,
      next_session_date: row.next_session_date ?? null,
      session_outcome: asString(row.session_outcome) || null,
      notes: asString(row.notes) || null,
      deleted_at: null
    };
  }

  return {
    id,
    case_id: caseId,
    court: asString(row.court),
    session_date: asString(row.session_date ?? row.date).slice(0, 10),
    session_time: asString(row.session_time ?? row.time, '09:00:00'),
    status: asString(row.status, 'مجدولة'),
    session_type: asString(row.session_type ?? row.type) || null,
    notes: asString(row.notes) || null,
    deleted_at: null
  };
}

function mapPaymentRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const caseId = asUuid(row.case_id ?? row.caseId);
  const amount = asNumber(row.amount);
  if (!id || !caseId || amount <= 0) return null;

  return {
    id,
    firm_id: firmId,
    case_id: caseId,
    amount,
    payment_date: asString(row.payment_date ?? row.created_at, new Date().toISOString()).slice(0, 10),
    payment_method: normalizePaymentMethod(row.payment_method),
    notes: asString(row.notes) || null,
    receipt_storage_path: asString(row.receipt_storage_path) || null,
    receipt_file_name: asString(row.receipt_file_name) || null,
    deleted_at: null
  };
}

function mapReceiptRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const caseId = asUuid(row.case_id);
  const paymentId = asUuid(row.case_payment_id);
  const receiptNumber = asString(row.receipt_number);
  const amount = asNumber(row.amount);
  if (!id || !caseId || !paymentId || !receiptNumber || amount <= 0) return null;

  return {
    id,
    firm_id: firmId,
    case_id: caseId,
    case_payment_id: paymentId,
    receipt_number: receiptNumber,
    amount,
    client_name: asString(row.client_name) || null,
    case_number: asString(row.case_number) || null,
    contract_total: row.contract_total != null ? asNumber(row.contract_total) : null,
    remaining_balance: row.remaining_balance != null ? asNumber(row.remaining_balance) : null,
    payment_method: asString(row.payment_method) || null,
    notes: asString(row.notes) || null,
    qr_payload: asString(row.qr_payload) || null,
    printed_at: row.printed_at ?? new Date().toISOString(),
    printed_by: asUuid(row.printed_by),
    reprint_count: Math.max(0, asNumber(row.reprint_count))
  };
}

function mapExpenseRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const title = asString(row.title);
  if (!id || title.length < 2) return null;

  return {
    id,
    firm_id: firmId,
    title,
    amount: Math.max(0, asNumber(row.amount)),
    category: asString(row.category, 'عام'),
    expense_date: asString(row.expense_date, new Date().toISOString()).slice(0, 10),
    notes: asString(row.notes) || null,
    deleted_at: null
  };
}

function mapTimelineRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const caseId = asUuid(row.case_id);
  const eventType = asString(row.event_type);
  const title = asString(row.title);
  if (!id || !caseId || !eventType || !title) return null;

  return {
    id,
    firm_id: firmId,
    case_id: caseId,
    event_type: eventType,
    title,
    details: asString(row.details) || null,
    metadata: row.metadata ?? {},
    actor_id: asUuid(row.actor_id),
    created_at: row.created_at ?? new Date().toISOString()
  };
}

function mapNotificationRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const title = asString(row.title);
  const message = asString(row.message);
  if (!id || !title || !message) return null;

  return {
    id,
    firm_id: firmId,
    employee_id: asUuid(row.employee_id),
    title,
    message,
    type: asString(row.type, 'system'),
    read: Boolean(row.read),
    created_at: row.created_at ?? new Date().toISOString()
  };
}

function mapExecutionRequestRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const title = asString(row.title);
  if (!id || title.length < 2) return null;

  return {
    id,
    firm_id: firmId,
    client_id: asUuid(row.client_id),
    case_id: asUuid(row.case_id),
    title,
    court: asString(row.court),
    request_number: asString(row.request_number),
    status: asString(row.status, 'pending'),
    notes: asString(row.notes) || null,
    due_date: row.due_date ?? null,
    created_by: asUuid(row.created_by),
    deleted_at: null
  };
}

function mapSubscriptionRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const planType = asString(row.plan_type);
  if (!id || !planType) return null;

  return {
    id,
    firm_id: firmId,
    plan_type: planType,
    status: asString(row.status, 'pending'),
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    created_at: row.created_at ?? new Date().toISOString()
  };
}

function mapSubscriptionRequestRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  if (!id) return null;

  return {
    id,
    firm_id: firmId,
    plan: asString(row.plan) || null,
    amount_yer: row.amount_yer != null ? asNumber(row.amount_yer) : null,
    transfer_reference: asString(row.transfer_reference) || null,
    receipt_path: asString(row.receipt_path) || null,
    receipt_url: asString(row.receipt_url) || null,
    status: asString(row.status, 'pending'),
    subscription_id: asUuid(row.subscription_id),
    payment_id: asUuid(row.payment_id),
    admin_notes: asString(row.admin_notes) || null,
    created_at: row.created_at ?? new Date().toISOString()
  };
}

function mapInvitationRow(row: Record<string, unknown>, firmId: string): Record<string, unknown> | null {
  const id = asUuid(row.id);
  const email = asString(row.email);
  const tokenHash = asString(row.token_hash);
  if (!id || !email || !tokenHash) return null;

  return {
    id,
    firm_id: firmId,
    email,
    role: row.role ?? 'assistant',
    firm_role_id: asUuid(row.firm_role_id),
    full_name: asString(row.full_name) || null,
    phone: normalizePhone(row.phone),
    status: asString(row.status, 'pending'),
    token_hash: tokenHash,
    invited_by: asUuid(row.invited_by),
    employee_id: asUuid(row.employee_id),
    expires_at: row.expires_at ?? new Date(Date.now() + 7 * 86400000).toISOString(),
    accepted_at: row.accepted_at ?? null
  };
}

async function restoreCaseAttachments(
  zip: JSZip,
  rows: Record<string, unknown>[],
  caseTitles: Map<string, string>
): Promise<{ count: number; failures: string[] }> {
  const manifest = await loadJsonArray(zip, 'attachments/manifest.json');
  const metaById = new Map<string, Record<string, unknown>>();
  const failures: string[] = [];

  for (const row of rows) {
    const id = asUuid(row.id);
    if (id) metaById.set(id, row);
  }
  for (const row of manifest) {
    const id = asUuid(row.id);
    if (id) metaById.set(id, { ...metaById.get(id), ...row });
  }

  let restored = 0;
  for (const [id, entry] of metaById) {
    const caseId = asUuid(entry.case_id);
    const fileName = asString(entry.file_name);
    if (!caseId || !fileName) continue;

    const caseTitle = caseTitles.get(caseId) ?? 'عام';
    const safeFolder = caseTitle.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'عام';
    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, '-').trim();

    let blob: Blob | null = null;
    const direct = zip.file(`attachments/${safeFolder}/${safeName}`);
    if (direct) blob = await direct.async('blob');
    if (!blob) {
      for (const [path, file] of Object.entries(zip.files)) {
        if (!file.dir && path.startsWith('attachments/') && path.endsWith(`/${safeName}`)) {
          blob = await file.async('blob');
          break;
        }
      }
    }
    if (!blob) {
      failures.push(`مرفق ${fileName}: الملف غير موجود في الأرشيف`);
      continue;
    }

    const storagePath = `${caseId}/attachments/${Date.now()}-restore-${id.slice(0, 8)}`;
    const { error: storageError } = await supabase.storage.from('case-documents').upload(storagePath, blob, {
      upsert: true,
      contentType: blob.type || 'application/octet-stream'
    });
    if (storageError) {
      failures.push(`مرفق ${fileName}: فشل الرفع — ${storageError.message}`);
      continue;
    }

    const { error } = await supabase.from('case_attachments').upsert(
      {
        id,
        case_id: caseId,
        file_name: fileName,
        file_type: inferDocumentType(fileName, entry.file_type),
        file_size: blob.size,
        storage_path: storagePath,
        uploaded_by: asUuid(entry.uploaded_by),
        version: Math.max(1, asNumber(entry.version, 1)),
        notes: asString(entry.notes) || null,
        deleted_at: null
      },
      { onConflict: 'id' }
    );
    if (error) failures.push(`مرفق ${fileName}: فشل حفظ السجل — ${error.message}`);
    else restored += 1;
  }

  return { count: restored, failures };
}

async function upsertBatches(table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  let count = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'id' });
    throwIfSupabaseError(error);
    count += batch.length;
  }
  return count;
}

async function upsertEmployees(rows: Record<string, unknown>[]): Promise<{ count: number; warnings: string[] }> {
  const warnings: string[] = [];
  let count = 0;

  for (const row of rows) {
    const id = asUuid(row.id);
    if (!id) continue;

    const { data: existing } = await supabase.from('employees').select('id, auth_uid').eq('id', id).maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('employees')
        .update({
          full_name: row.full_name,
          phone: row.phone,
          role: row.role,
          status: row.status,
          firm_role_id: row.firm_role_id,
          individual_permissions: row.individual_permissions,
          profile_image: row.profile_image,
          deleted_at: null
        })
        .eq('id', id);
      if (!error) count += 1;
      else warnings.push(`تعذر تحديث الموظف ${id}: ${error.message}`);
    } else {
      const { error } = await supabase.from('employees').insert({
        ...row,
        auth_uid: null
      });
      if (!error) {
        count += 1;
        warnings.push(`تمت إضافة موظف ${row.email} بدون حساب دخول — يحتاج دعوة جديدة`);
      } else {
        warnings.push(`تعذر إضافة الموظف ${row.email}: ${error.message}`);
      }
    }
  }

  return { count, warnings };
}

async function findDocumentBlob(
  zip: JSZip,
  title: string,
  caseTitle: string
): Promise<Blob | null> {
  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '-').trim();
  const safeFolder = caseTitle.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'عام';

  const direct = zip.file(`documents/${safeFolder}/${safeTitle}`);
  if (direct) return direct.async('blob');

  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir || !path.startsWith('documents/')) continue;
    if (path.endsWith(`/${safeTitle}`)) return file.async('blob');
  }
  return null;
}

async function restoreDocuments(
  zip: JSZip,
  rows: Record<string, unknown>[],
  caseTitles: Map<string, string>
): Promise<{ count: number; failures: string[] }> {
  const manifest = await loadJsonArray(zip, 'documents/manifest.json');
  const metaById = new Map<string, Record<string, unknown>>();
  const failures: string[] = [];

  for (const row of rows) {
    const id = asUuid(row.id);
    if (id) metaById.set(id, row);
  }
  for (const row of manifest) {
    const id = asUuid(row.id);
    if (id) metaById.set(id, { ...metaById.get(id), ...row });
  }

  let restored = 0;
  for (const [id, entry] of metaById) {
    const caseId = asUuid(entry.case_id ?? entry.caseId);
    const title = asString(entry.title);
    if (!caseId || !title) {
      failures.push(`مستند ${id}: بيانات ناقصة`);
      continue;
    }

    const caseTitle = asString(entry.case_title) || caseTitles.get(caseId) || 'عام';
    const blob = await findDocumentBlob(zip, title, caseTitle);
    if (!blob) {
      failures.push(`مستند ${title}: الملف غير موجود في الأرشيف`);
      continue;
    }

    const storagePath = `${caseId}/${Date.now()}-restore-${id.slice(0, 8)}`;
    const isEncrypted = Boolean(entry.encrypted ?? entry.is_encrypted);

    const { error: storageError } = await supabase.storage.from('case-documents').upload(storagePath, blob, {
      upsert: true,
      contentType: isEncrypted ? 'application/octet-stream' : blob.type || 'application/octet-stream'
    });
    if (storageError) {
      failures.push(`مستند ${title}: فشل الرفع — ${storageError.message}`);
      continue;
    }

    const { data: signed } = await supabase.storage.from('case-documents').createSignedUrl(storagePath, 3600);

    const { error } = await supabase.from('documents').upsert(
      {
        id,
        case_id: caseId,
        title,
        category: asString(entry.category, 'مستند قانوني'),
        file_type: inferDocumentType(title, entry.file_type),
        file_size: blob.size,
        storage_path: storagePath,
        url: signed?.signedUrl ?? null,
        is_encrypted: isEncrypted,
        deleted_at: null
      },
      { onConflict: 'id' }
    );
    if (error) failures.push(`مستند ${title}: فشل حفظ السجل — ${error.message}`);
    else restored += 1;
  }

  return { count: restored, failures };
}

export async function restoreFirmBackupData(zip: JSZip): Promise<RestoreResult> {
  const firmId = await getCurrentFirmId();
  const restored: string[] = [];
  const warnings: string[] = [];
  const documentFailures: string[] = [];
  const caseTitles = new Map<string, string>();

  backupLog('restore', 'start');

  const firmRoleRows = (await loadEntityRows(zip, 'firm_roles'))
    .map((row) => mapFirmRoleRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (firmRoleRows.length) {
    const count = await upsertBatches('firm_roles', firmRoleRows);
    if (count) restored.push(`firm_roles (${count})`);
  }

  const employeeRows = (await loadEntityRows(zip, 'employees'))
    .map((row) => mapEmployeeRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (employeeRows.length) {
    const { count, warnings: empWarnings } = await upsertEmployees(employeeRows);
    if (count) restored.push(`employees (${count})`);
    warnings.push(...empWarnings);
  }

  const lawyerRows = (await loadEntityRows(zip, 'lawyers'))
    .map((row) => mapLawyerRow(row))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (lawyerRows.length) {
    const count = await upsertBatches('lawyers', lawyerRows);
    if (count) restored.push(`lawyers (${count})`);
  }

  const clientRows = (await loadEntityRows(zip, 'clients'))
    .map((row) => mapClientRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (clientRows.length) {
    const count = await upsertBatches('clients', clientRows);
    if (count) restored.push(`clients (${count})`);
  }

  const caseRows = (await loadEntityRows(zip, 'cases'))
    .map((row) => mapCaseRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  for (const row of caseRows) {
    caseTitles.set(String(row.id), String(row.title));
  }
  if (caseRows.length) {
    const count = await upsertBatches('cases', caseRows);
    if (count) restored.push(`cases (${count})`);
  }

  const sessionRows = (await loadEntityRows(zip, 'sessions'))
    .map((row) => mapSessionRow(row))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (sessionRows.length) {
    const count = await upsertBatches('sessions', sessionRows);
    if (count) restored.push(`sessions (${count})`);
  }

  const paymentRows = (await loadEntityRows(zip, 'payments'))
    .map((row) => mapPaymentRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (paymentRows.length) {
    const count = await upsertBatches('case_payments', paymentRows);
    if (count) restored.push(`payments (${count})`);
  }

  const receiptRows = (await loadEntityRows(zip, 'receipts'))
    .map((row) => mapReceiptRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (receiptRows.length) {
    const count = await upsertBatches('receipt_vouchers', receiptRows);
    if (count) restored.push(`receipts (${count})`);
  }

  const expenseRows = (await loadEntityRows(zip, 'expenses'))
    .map((row) => mapExpenseRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (expenseRows.length) {
    const count = await upsertBatches('office_expenses', expenseRows);
    if (count) restored.push(`expenses (${count})`);
  }

  const executionRows = (await loadEntityRows(zip, 'execution_requests'))
    .map((row) => mapExecutionRequestRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (executionRows.length) {
    const count = await upsertBatches('execution_requests', executionRows);
    if (count) restored.push(`execution_requests (${count})`);
  }

  const timelineRows = (await loadEntityRows(zip, 'timeline'))
    .map((row) => mapTimelineRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (timelineRows.length) {
    const count = await upsertBatches('case_timeline_events', timelineRows);
    if (count) restored.push(`timeline (${count})`);
  }

  const notificationRows = (await loadEntityRows(zip, 'notifications'))
    .map((row) => mapNotificationRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (notificationRows.length) {
    const count = await upsertBatches('notifications', notificationRows);
    if (count) restored.push(`notifications (${count})`);
  }

  const subscriptionRows = (await loadEntityRows(zip, 'subscriptions'))
    .map((row) => mapSubscriptionRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (subscriptionRows.length) {
    const count = await upsertBatches('subscriptions', subscriptionRows);
    if (count) restored.push(`subscriptions (${count})`);
  }

  const subRequestRows = (await loadEntityRows(zip, 'subscription_requests'))
    .map((row) => mapSubscriptionRequestRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (subRequestRows.length) {
    const count = await upsertBatches('subscription_requests', subRequestRows);
    if (count) restored.push(`subscription_requests (${count})`);
  }

  const invitationRows = (await loadEntityRows(zip, 'invitations'))
    .map((row) => mapInvitationRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (invitationRows.length) {
    try {
      const count = await upsertBatches('invitations', invitationRows);
      if (count) restored.push(`invitations (${count})`);
    } catch (err) {
      warnings.push(`تعذر استعادة بعض الدعوات: ${err instanceof Error ? err.message : 'خطأ'}`);
    }
  }

  const docRows = await loadEntityRows(zip, 'documents');
  const { count: docCount, failures } = await restoreDocuments(zip, docRows, caseTitles);
  if (docCount) restored.push(`documents (${docCount})`);
  documentFailures.push(...failures);

  const attachmentRows = await loadEntityRows(zip, 'case_attachments');
  const { count: attachmentCount, failures: attachmentFailures } = await restoreCaseAttachments(
    zip,
    attachmentRows,
    caseTitles
  );
  if (attachmentCount) restored.push(`case_attachments (${attachmentCount})`);
  documentFailures.push(...attachmentFailures);

  backupLog('restore', `done — ${restored.join(', ')}`);
  return { restored, warnings, documentFailures };
}

export { RESTORE_ORDER } from './backupTypes';

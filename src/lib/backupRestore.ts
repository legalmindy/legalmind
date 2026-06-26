import JSZip from 'jszip';
import { getCurrentFirmId } from './api';
import type { ExportEntity } from './dataExport';
import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

const CASE_TYPES = ['مدنية', 'تجارية', 'أحوال شخصية', 'عمالية', 'مستعجلة', 'جنائية'] as const;
const CASE_STAGES = ['ابتدائي مدني', 'ابتدائي شخصي', 'ابتدائي جنائي', 'استئناف', 'نقض'] as const;
const CASE_STATUSES = ['active', 'archived', 'closed'] as const;
const PAYMENT_METHODS = ['نقداً', 'تحويل بنكي', 'شيك', 'محفظة إلكترونية', 'أخرى'] as const;

const RESTORE_ORDER: ExportEntity[] = [
  'clients',
  'cases',
  'sessions',
  'payments',
  'expenses',
  'receipts',
  'documents'
];

const BATCH_SIZE = 80;

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

  if (isRawCaseRow(row)) {
    const total = asNumber(row.total_amount);
    const paid = Math.min(asNumber(row.paid_amount), total);
    return {
      id,
      firm_id: firmId,
      client_id: clientId,
      assigned_lawyer_id: null,
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
    assigned_lawyer_id: null,
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
    deleted_at: null
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
): Promise<number> {
  const manifest = await loadJsonArray(zip, 'documents/manifest.json');
  const metaById = new Map<string, Record<string, unknown>>();

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
    if (!caseId || !title) continue;

    const caseTitle =
      asString(entry.case_title) ||
      caseTitles.get(caseId) ||
      'عام';

    const blob = await findDocumentBlob(zip, title, caseTitle);
    if (!blob) continue;

    const storagePath = `${caseId}/${Date.now()}-restore-${id.slice(0, 8)}`;
    const isEncrypted = Boolean(entry.encrypted ?? entry.is_encrypted);

    const { error: storageError } = await supabase.storage
      .from('case-documents')
      .upload(storagePath, blob, {
        upsert: true,
        contentType: isEncrypted ? 'application/octet-stream' : blob.type || 'application/octet-stream'
      });
    if (storageError) continue;

    const { data: signed } = await supabase.storage
      .from('case-documents')
      .createSignedUrl(storagePath, 3600);

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
    if (!error) restored += 1;
  }

  return restored;
}

export async function restoreFirmBackupData(zip: JSZip): Promise<string[]> {
  const firmId = await getCurrentFirmId();
  const restored: string[] = [];
  const caseTitles = new Map<string, string>();

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

  const expenseRows = (await loadEntityRows(zip, 'expenses'))
    .map((row) => mapExpenseRow(row, firmId))
    .filter((row): row is Record<string, unknown> => row !== null);
  if (expenseRows.length) {
    const count = await upsertBatches('office_expenses', expenseRows);
    if (count) restored.push(`expenses (${count})`);
  }

  const docRows = await loadEntityRows(zip, 'documents');
  const docCount = await restoreDocuments(zip, docRows, caseTitles);
  if (docCount) restored.push(`documents (${docCount})`);

  return restored;
}

export { RESTORE_ORDER };

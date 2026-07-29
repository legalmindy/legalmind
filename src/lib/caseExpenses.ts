import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import { validateReceiptFile } from './subscription';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import type {
  CaseExpense,
  CaseExpenseAlerts,
  CaseExpensePaidBy,
  CaseExpensePaymentStatus,
  CaseExpenseReportRow,
  CaseExpenseType
} from '../types/app';

function mapExpense(row: Record<string, unknown>): CaseExpense {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    expenseType: String(row.expense_type),
    amount: Number(row.amount),
    expenseDate: String(row.expense_date),
    paymentStatus: row.payment_status as CaseExpensePaymentStatus,
    paidBy: row.paid_by as CaseExpensePaidBy,
    courtName: (row.court_name as string) ?? undefined,
    receiptNumber: (row.receipt_number as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    dueDate: (row.due_date as string) ?? undefined,
    attachmentPath: (row.attachment_path as string) ?? undefined,
    attachmentFileName: (row.attachment_file_name as string) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapReportRow(row: Record<string, unknown>): CaseExpenseReportRow {
  return {
    expenseId: row.expense_id as string,
    caseId: row.case_id as string,
    caseTitle: String(row.case_title ?? ''),
    courtCaseNumber: String(row.court_case_number ?? ''),
    clientId: (row.client_id as string) ?? undefined,
    clientName: String(row.client_name ?? ''),
    lawyerId: (row.lawyer_id as string) ?? undefined,
    lawyerName: (row.lawyer_name as string) ?? undefined,
    expenseType: String(row.expense_type),
    amount: Number(row.amount),
    expenseDate: String(row.expense_date),
    paymentStatus: row.payment_status as CaseExpensePaymentStatus,
    paidBy: row.paid_by as CaseExpensePaidBy,
    courtName: (row.court_name as string) ?? undefined,
    receiptNumber: (row.receipt_number as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
    dueDate: (row.due_date as string) ?? undefined,
    attachmentPath: (row.attachment_path as string) ?? undefined,
    attachmentFileName: (row.attachment_file_name as string) ?? undefined
  };
}

export async function fetchCaseExpenses(caseId: string): Promise<CaseExpense[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('case_expenses')
    .select('*')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });
  throwIfSupabaseError(error);
  return (data ?? []).map((row) => mapExpense(row as Record<string, unknown>));
}

export async function fetchCaseExpenseTypes(): Promise<CaseExpenseType[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('case_expense_types')
    .select('id, name, is_system, sort_order')
    .eq('firm_id', firmId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  throwIfSupabaseError(error);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: String(row.name),
    isSystem: Boolean(row.is_system),
    sortOrder: Number(row.sort_order ?? 100)
  }));
}

export async function addCaseExpenseType(name: string): Promise<CaseExpenseType> {
  const { data, error } = await supabase.rpc('add_case_expense_type', { p_name: name });
  throwIfSupabaseError(error);
  const result = data as { ok?: boolean; id?: string; name?: string };
  if (!result?.id) throw new Error('تعذر إضافة نوع المصروف.');
  return { id: result.id, name: result.name ?? name, isSystem: false, sortOrder: 500 };
}

export async function addCaseExpense(input: {
  caseId: string;
  expenseType: string;
  amount: number;
  expenseDate: string;
  paymentStatus: CaseExpensePaymentStatus;
  paidBy: CaseExpensePaidBy;
  courtName?: string;
  receiptNumber?: string;
  notes?: string;
  dueDate?: string;
  attachmentPath?: string;
  attachmentFileName?: string;
}): Promise<{ expenseId: string }> {
  const { data, error } = await supabase.rpc('add_case_expense', {
    p_case_id: input.caseId,
    p_expense_type: input.expenseType,
    p_amount: input.amount,
    p_expense_date: input.expenseDate,
    p_payment_status: input.paymentStatus,
    p_paid_by: input.paidBy,
    p_court_name: input.courtName ?? null,
    p_receipt_number: input.receiptNumber ?? null,
    p_notes: input.notes ?? null,
    p_due_date: input.dueDate ?? null,
    p_attachment_path: input.attachmentPath ?? null,
    p_attachment_file_name: input.attachmentFileName ?? null
  });
  throwIfSupabaseError(error);
  const result = data as { ok?: boolean; expense_id?: string };
  if (!result?.expense_id) throw new Error('تعذر تسجيل المصروف.');
  return { expenseId: result.expense_id };
}

export async function updateCaseExpense(input: {
  expenseId: string;
  expenseType?: string;
  amount?: number;
  expenseDate?: string;
  paymentStatus?: CaseExpensePaymentStatus;
  paidBy?: CaseExpensePaidBy;
  courtName?: string;
  receiptNumber?: string;
  notes?: string;
  dueDate?: string | null;
  attachmentPath?: string;
  attachmentFileName?: string;
  clearDueDate?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('update_case_expense', {
    p_expense_id: input.expenseId,
    p_expense_type: input.expenseType ?? null,
    p_amount: input.amount ?? null,
    p_expense_date: input.expenseDate ?? null,
    p_payment_status: input.paymentStatus ?? null,
    p_paid_by: input.paidBy ?? null,
    p_court_name: input.courtName ?? null,
    p_receipt_number: input.receiptNumber ?? null,
    p_notes: input.notes ?? null,
    p_due_date: input.dueDate ?? null,
    p_attachment_path: input.attachmentPath ?? null,
    p_attachment_file_name: input.attachmentFileName ?? null,
    p_clear_due_date: input.clearDueDate ?? false
  });
  throwIfSupabaseError(error);
}

export async function softDeleteCaseExpense(expenseId: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_case_expense', { p_expense_id: expenseId });
  throwIfSupabaseError(error);
}

export async function uploadCaseExpenseReceipt(
  caseId: string,
  expenseId: string,
  file: File
): Promise<{ path: string; fileName: string }> {
  const validation = validateReceiptFile(file);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'ملف الإيصال غير صالح.');
  }
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `${caseId}/${expenseId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('case-expense-receipts').upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });
  if (error) throw error;
  return { path, fileName: file.name };
}

export async function getCaseExpenseReceiptUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('case-expense-receipts')
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function fetchCaseExpensesReport(filters: {
  from?: string;
  to?: string;
  courtName?: string;
  lawyerId?: string;
  expenseType?: string;
  clientId?: string;
  caseId?: string;
  paymentStatus?: string;
}): Promise<CaseExpenseReportRow[]> {
  const { data, error } = await supabase.rpc('get_case_expenses_report', {
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_court_name: filters.courtName || null,
    p_lawyer_id: filters.lawyerId || null,
    p_expense_type: filters.expenseType || null,
    p_client_id: filters.clientId || null,
    p_case_id: filters.caseId || null,
    p_payment_status: filters.paymentStatus || null
  });
  throwIfSupabaseError(error);
  return (data ?? []).map((row: Record<string, unknown>) => mapReportRow(row));
}

export async function fetchCaseExpenseAlerts(dueWithinDays = 7): Promise<CaseExpenseAlerts> {
  const { data, error } = await supabase.rpc('get_case_expense_alerts', {
    p_due_within_days: dueWithinDays
  });
  throwIfSupabaseError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    unpaidCount: Number(row.unpaid_count ?? 0),
    unpaidAmount: Number(row.unpaid_amount ?? 0),
    dueSoon: Array.isArray(row.due_soon)
      ? (row.due_soon as Record<string, unknown>[]).map((x) => ({
          expenseId: String(x.expense_id),
          caseId: String(x.case_id),
          caseTitle: String(x.case_title ?? ''),
          expenseType: String(x.expense_type ?? ''),
          amount: Number(x.amount ?? 0),
          dueDate: String(x.due_date ?? '')
        }))
      : [],
    overBudget: Array.isArray(row.over_budget)
      ? (row.over_budget as Record<string, unknown>[]).map((x) => ({
          caseId: String(x.case_id),
          caseTitle: String(x.case_title ?? ''),
          expenseBudget: Number(x.expense_budget ?? 0),
          totalExpenses: Number(x.total_expenses ?? 0)
        }))
      : []
  };
}

export async function updateCaseExpenseBudget(caseId: string, budget: number | null): Promise<void> {
  const firmId = await getCurrentFirmId();
  const { error } = await supabase
    .from('cases')
    .update({ expense_budget: budget })
    .eq('id', caseId)
    .eq('firm_id', firmId);
  throwIfSupabaseError(error);
}

export function summarizeCaseExpenses(expenses: CaseExpense[]) {
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const paid = expenses.filter((e) => e.paymentStatus === 'مدفوع').reduce((s, e) => s + e.amount, 0);
  const unpaid = total - paid;
  return { total, paid, unpaid, count: expenses.length };
}

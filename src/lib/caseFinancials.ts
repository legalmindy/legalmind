import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import type { CaseFinancialSummary, CasePayment } from '../types/app';

function mapPayment(row: Record<string, unknown>): CasePayment {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    amount: Number(row.amount),
    paymentDate: String(row.payment_date),
    paymentMethod: String(row.payment_method),
    notes: (row.notes as string) ?? undefined,
    receiptStoragePath: (row.receipt_storage_path as string) ?? undefined,
    receiptFileName: (row.receipt_file_name as string) ?? undefined,
    createdAt: String(row.created_at)
  };
}

export async function fetchCasePayments(caseId: string): Promise<CasePayment[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('case_payments')
    .select('*')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });
  throwIfSupabaseError(error);
  return (data ?? []).map(mapPayment);
}

export async function fetchCaseFinancialSummary(caseId: string): Promise<CaseFinancialSummary | null> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('v_case_financial_summary')
    .select('*')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .maybeSingle();
  throwIfSupabaseError(error);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    contractTotal: Number(row.contract_total),
    totalPaid: Number(row.total_paid),
    remaining: Number(row.remaining_amount),
    paymentPercentage: Number(row.payment_percentage),
    lastPaymentDate: (row.last_payment_date as string) ?? undefined,
    lastPaymentAmount: row.last_payment_amount != null ? Number(row.last_payment_amount) : undefined,
    currency: String(row.contract_currency ?? 'YER'),
    contractDate: (row.contract_date as string) ?? undefined
  };
}

export async function addCasePayment(input: {
  caseId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  notes?: string;
  receiptStoragePath?: string;
  receiptFileName?: string;
}): Promise<{ paymentId: string }> {
  const { data, error } = await supabase.rpc('add_case_payment', {
    p_case_id: input.caseId,
    p_amount: input.amount,
    p_payment_date: input.paymentDate,
    p_payment_method: input.paymentMethod,
    p_notes: input.notes ?? null,
    p_receipt_storage_path: input.receiptStoragePath ?? null,
    p_receipt_file_name: input.receiptFileName ?? null
  });
  throwIfSupabaseError(error);
  const result = data as { ok?: boolean; payment_id?: string };
  if (!result?.payment_id) throw new Error('تعذر تسجيل الدفعة.');
  return { paymentId: result.payment_id };
}

export async function uploadPaymentReceipt(
  caseId: string,
  paymentId: string,
  file: File
): Promise<{ path: string; fileName: string }> {
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `${caseId}/${paymentId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('case-payment-receipts').upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });
  if (error) throw error;
  return { path, fileName: file.name };
}

export async function updateCasePaymentReceipt(
  paymentId: string,
  storagePath: string,
  fileName: string
): Promise<void> {
  const firmId = await getCurrentFirmId();
  const { error } = await supabase
    .from('case_payments')
    .update({ receipt_storage_path: storagePath, receipt_file_name: fileName })
    .eq('id', paymentId)
    .eq('firm_id', firmId);
  throwIfSupabaseError(error);
}

export async function getPaymentReceiptUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('case-payment-receipts')
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

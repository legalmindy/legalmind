import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import type { ExecutionRequest, ExecutionRequestStatus } from '../types/app';

const STATUS_LABELS: Record<ExecutionRequestStatus, string> = {
  pending: 'قيد الانتظار',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتمل',
  rejected: 'مرفوض'
};

export function getExecutionStatusLabel(status: ExecutionRequestStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function mapRow(row: Record<string, unknown>): ExecutionRequest {
  const client = row.clients as { name?: string } | null;
  const caseRow = row.cases as { title?: string } | null;
  return {
    id: row.id as string,
    clientId: (row.client_id as string) ?? undefined,
    clientName: client?.name,
    caseId: (row.case_id as string) ?? undefined,
    caseTitle: caseRow?.title,
    title: row.title as string,
    court: (row.court as string) ?? '',
    requestNumber: (row.request_number as string) ?? '',
    status: row.status as ExecutionRequestStatus,
    notes: (row.notes as string) ?? undefined,
    dueDate: (row.due_date as string) ?? undefined,
    createdAt: row.created_at as string
  };
}

export async function fetchExecutionRequests(): Promise<ExecutionRequest[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('execution_requests')
    .select('*, clients(name), cases(title)')
    .eq('firm_id', firmId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export type ExecutionRequestInput = {
  title: string;
  court: string;
  requestNumber: string;
  status: ExecutionRequestStatus;
  clientId?: string;
  caseId?: string;
  notes?: string;
  dueDate?: string;
};

export async function createExecutionRequest(input: ExecutionRequestInput): Promise<ExecutionRequest> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('execution_requests')
    .insert({
      firm_id: firmId,
      title: input.title.trim(),
      court: input.court.trim(),
      request_number: input.requestNumber.trim(),
      status: input.status,
      client_id: input.clientId || null,
      case_id: input.caseId || null,
      notes: input.notes?.trim() || null,
      due_date: input.dueDate || null
    })
    .select('*, clients(name), cases(title)')
    .single();

  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function updateExecutionRequest(id: string, input: Partial<ExecutionRequestInput>): Promise<ExecutionRequest> {
  const { data, error } = await supabase
    .from('execution_requests')
    .update({
      title: input.title?.trim(),
      court: input.court?.trim(),
      request_number: input.requestNumber?.trim(),
      status: input.status,
      client_id: input.clientId,
      case_id: input.caseId,
      notes: input.notes?.trim(),
      due_date: input.dueDate ?? null
    })
    .eq('id', id)
    .select('*, clients(name), cases(title)')
    .single();

  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function deleteExecutionRequest(id: string): Promise<void> {
  const { error } = await supabase
    .from('execution_requests')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

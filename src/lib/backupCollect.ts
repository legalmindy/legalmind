import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import type { BackupTable } from './backupTypes';
import { backupLog } from './backupValidation';

const PAGE_SIZE = 500;

async function fetchCaseIds(firmId: string): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('cases')
      .select('id')
      .eq('firm_id', firmId)
      .is('deleted_at', null)
      .range(from, from + PAGE_SIZE - 1);
    throwIfSupabaseError(error);
    const batch = (data ?? []).map((c) => c.id as string);
    ids.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return ids;
}

async function fetchPaginated(
  table: string,
  firmId: string,
  withDeletedFilter = false
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select('*').eq('firm_id', firmId);
    if (withDeletedFilter) query = query.is('deleted_at', null);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    throwIfSupabaseError(error);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

export async function collectRawBackupRows(entity: BackupTable, firmId: string): Promise<Record<string, unknown>[]> {
  backupLog('collect', entity);

  switch (entity) {
    case 'firm_roles': {
      const { data, error } = await supabase.from('firm_roles').select('*').eq('firm_id', firmId);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'employees': {
      const { data, error } = await supabase
        .from('employees')
        .select(
          'id, firm_id, full_name, email, phone, role, status, firm_role_id, individual_permissions, profile_image, created_at, updated_at'
        )
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'lawyers': {
      const { data: employees, error: empError } = await supabase
        .from('employees')
        .select('id')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(empError);
      const employeeIds = (employees ?? []).map((e) => e.id as string);
      if (!employeeIds.length) return [];
      const { data, error } = await supabase.from('lawyers').select('*').in('employee_id', employeeIds);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'clients': {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'cases': {
      const { data, error } = await supabase
        .from('cases')
        .select(
          'id, firm_id, client_id, assigned_lawyer_id, court_case_number, title, case_type, case_stage, category, court, description, total_amount, paid_amount, status, contract_currency, contract_date, notes, judgment_date, archive_date, created_at, updated_at'
        )
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'sessions': {
      const caseIds = await fetchCaseIds(firmId);
      if (!caseIds.length) return [];
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < caseIds.length; i += PAGE_SIZE) {
        const chunk = caseIds.slice(i, i + PAGE_SIZE);
        const { data, error } = await supabase
          .from('sessions')
          .select('*')
          .in('case_id', chunk)
          .is('deleted_at', null);
        throwIfSupabaseError(error);
        rows.push(...((data ?? []) as Record<string, unknown>[]));
      }
      return rows;
    }
    case 'payments': {
      const { data, error } = await supabase
        .from('case_payments')
        .select('*')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'receipts': {
      const { data, error } = await supabase.from('receipt_vouchers').select('*').eq('firm_id', firmId);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'expenses': {
      const { data, error } = await supabase
        .from('office_expenses')
        .select('*')
        .eq('firm_id', firmId)
        .is('deleted_at', null);
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'execution_requests':
      return fetchPaginated('execution_requests', firmId, true);
    case 'timeline':
      return fetchPaginated('case_timeline_events', firmId);
    case 'notifications':
      return fetchPaginated('notifications', firmId);
    case 'subscriptions':
      return fetchPaginated('subscriptions', firmId);
    case 'subscription_requests':
      return fetchPaginated('subscription_requests', firmId);
    case 'invitations': {
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('firm_id', firmId)
        .neq('status', 'cancelled');
      throwIfSupabaseError(error);
      return (data ?? []) as Record<string, unknown>[];
    }
    case 'case_attachments': {
      const caseIds = await fetchCaseIds(firmId);
      if (!caseIds.length) return [];
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < caseIds.length; i += PAGE_SIZE) {
        const chunk = caseIds.slice(i, i + PAGE_SIZE);
        const { data, error } = await supabase
          .from('case_attachments')
          .select('*')
          .in('case_id', chunk)
          .is('deleted_at', null);
        throwIfSupabaseError(error);
        rows.push(...((data ?? []) as Record<string, unknown>[]));
      }
      return rows;
    }
    case 'documents': {
      const caseIds = await fetchCaseIds(firmId);
      if (!caseIds.length) return [];
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < caseIds.length; i += PAGE_SIZE) {
        const chunk = caseIds.slice(i, i + PAGE_SIZE);
        const { data, error } = await supabase
          .from('documents')
          .select(
            'id, case_id, title, category, file_type, file_size, storage_path, is_encrypted, uploaded_at, uploaded_by'
          )
          .in('case_id', chunk)
          .is('deleted_at', null);
        throwIfSupabaseError(error);
        rows.push(...((data ?? []) as Record<string, unknown>[]));
      }
      return rows;
    }
    default:
      return [];
  }
}

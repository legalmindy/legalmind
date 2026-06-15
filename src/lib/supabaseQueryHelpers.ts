import type { PostgrestError } from '@supabase/supabase-js';

export class SupabaseQueryError extends Error {
  code?: string;
  details?: string;
  hint?: string;

  constructor(error: PostgrestError) {
    super(error.message);
    this.name = 'SupabaseQueryError';
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export function throwIfSupabaseError(error: PostgrestError | null): void {
  if (error) throw new SupabaseQueryError(error);
}

export function normalizeMaybeSingle<T>(data: T | null): T | null {
  return data ?? null;
}

export function requireRow<T>(data: T | null, message = 'Record not found.'): T {
  if (!data) throw new Error(message);
  return data;
}

/** Maps Supabase/Postgres errors to user-friendly Arabic messages for case saves. */
export function formatCaseSaveError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const details = err instanceof SupabaseQueryError ? (err.details ?? '') : '';
  const combined = `${message} ${details}`.toLowerCase();

  if (/client must belong|client_id.*foreign key|violates foreign key.*client/i.test(combined)) {
    return 'تعذر حفظ القضية. الموكل المختار غير مسجّل في النظام — أضف الموكل من صفحة العملاء أولاً.';
  }
  if (/assigned lawyer must belong|assigned_lawyer_id.*foreign key|violates foreign key.*lawyer/i.test(combined)) {
    return 'تعذر حفظ القضية. المحامي المختار غير مسجّل في النظام — تأكد من ظهوره في قائمة المحامين.';
  }
  if (/row-level security|rls|permission denied|42501/i.test(combined)) {
    return 'تعذر حفظ القضية. ليس لديك صلاحية إضافة قضايا — تواصل مع مدير المكتب.';
  }
  if (/unique|duplicate key|court_case_number/i.test(combined)) {
    return 'تعذر حفظ القضية. رقم القضية في المحكمة مستخدم مسبقاً في هذا المكتب.';
  }
  if (/paid_amount.*check|check constraint.*paid/i.test(combined)) {
    return 'تعذر حفظ القضية. المبلغ المدفوع لا يمكن أن يتجاوز إجمالي المبلغ.';
  }
  if (/invalid input value for enum|case_type|case_stage/i.test(combined)) {
    return 'تعذر حفظ القضية. نوع أو مرحلة القضية غير صالحة.';
  }
  if (/sync_version/i.test(combined)) {
    return 'تعذر حفظ القضية. إعدادات قاعدة البيانات تحتاج تحديث — نفّذ migration 020 في Supabase SQL Editor.';
  }
  return message || 'فشل حفظ القضية.';
}

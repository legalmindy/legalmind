import type { PostgrestError } from '@supabase/supabase-js';

import type { Invitation } from '../types/app';

export function formatInvitationError(error: PostgrestError | Error | unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: string }).message)
      : error instanceof Error
        ? error.message
        : '';

  const lower = message.toLowerCase();

  if (
    lower.includes('invalid_email') ||
    lower.includes('check constraint') && lower.includes('email') ||
    lower.includes('invitations_email_check')
  ) {
    return 'البريد الإلكتروني غير صالح. استخدم صيغة مثل name@example.com (أحرف إنجليزية فقط).';
  }

  if (
    lower.includes('idx_invitations_pending_email') ||
    lower.includes('duplicate key') ||
    lower.includes('already exists')
  ) {
    return 'يوجد دعوة قيد الانتظار لهذا البريد الإلكتروني بالفعل.';
  }

  if (
    lower.includes('gen_random_bytes') ||
    lower.includes('digest(') ||
    lower.includes('function digest')
  ) {
    return 'خطأ في إعداد قاعدة البيانات (pgcrypto). شغّل migration 031 و 032 في Supabase SQL Editor.';
  }

  if (lower.includes('only firm admins') || lower.includes('unauthorized') || lower.includes('not_authorized')) {
    return 'ليس لديك صلاحية إرسال دعوات. يجب أن تكون مدير المكتب.';
  }

  if (lower.includes('invalid role') || lower.includes('invalid invitation role')) {
    return 'الدور المحدد غير مدعوم للدعوة. اختر محامي أو مساعد.';
  }

  if (lower.includes('subscription') || lower.includes('inactive')) {
    return 'الاشتراك غير نشط. يرجى تجديد الاشتراك أولاً.';
  }

  if (message.trim()) return message;
  return 'فشل إرسال الدعوة. تحقق من البيانات وحاول مرة أخرى.';
}

export function mapRpcInvitationRow(
  row: Record<string, unknown>,
  extras?: { fullName?: string; phone?: string; firmId?: string }
): Invitation {
  return {
    id: row.id as string,
    firmId: extras?.firmId,
    officeId: extras?.firmId,
    email: row.email as string,
    fullName: extras?.fullName ?? '',
    phone: extras?.phone ?? '',
    role: row.role as Invitation['role'],
    status: row.status as Invitation['status'],
    expiresAt: row.expires_at as string,
    inviteUrl: (row.invite_url as string) ?? undefined,
    createdAt: new Date().toISOString()
  };
}

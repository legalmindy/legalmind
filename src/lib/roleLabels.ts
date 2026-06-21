import type { UserRole } from '../types/app';

/** Arabic labels for firm role templates (by slug). */
export const FIRM_ROLE_SLUG_LABELS: Record<string, string> = {
  firm_owner: 'مالك المكتب',
  managing_lawyer: 'محامٍ أول',
  lawyer: 'محامٍ',
  legal_assistant: 'مساعد قانوني',
  accountant: 'محاسب',
  secretary: 'سكرتير'
};

export const LEGACY_ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'مدير المنصة',
  admin: 'مدير',
  firm_manager: 'مالك المكتب',
  lawyer: 'محامٍ',
  assistant: 'مساعد'
};

/** Prefer firm template name; normalize legacy English fragments. */
export function resolveRoleDisplayName(
  firmRoleName?: string | null,
  firmRoleSlug?: string | null,
  legacyRole?: UserRole | string | null
): string {
  if (firmRoleSlug && FIRM_ROLE_SLUG_LABELS[firmRoleSlug]) {
    return FIRM_ROLE_SLUG_LABELS[firmRoleSlug];
  }
  const trimmed = firmRoleName?.trim();
  if (trimmed) {
    if (/managing/i.test(trimmed)) return 'محامٍ أول';
    return trimmed;
  }
  if (legacyRole && legacyRole in LEGACY_ROLE_LABELS) {
    return LEGACY_ROLE_LABELS[legacyRole as UserRole];
  }
  return 'عضو';
}

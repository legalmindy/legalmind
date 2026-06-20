import type { UserRole } from '../types/app';

/** مدير المكتب — الوصول الكامل للوحة الإدارة وعرض 360° */
export function isFirmManagerRole(role: UserRole | string): boolean {
  return role === 'firm_manager' || role === 'super_admin';
}

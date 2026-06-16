/** Plan features shown on subscription cards (matches product offering). */
export const SUBSCRIPTION_PLAN_FEATURES = [
  'إدارة طلبات التنفيذ',
  'إدارة العملاء',
  'إرسال التقارير للعملاء عبر WhatsApp',
  'إرسال التقارير للعملاء عبر رسائل SMS'
] as const;

export const TRIAL_PLAN_FEATURES = [
  'شهر مجاني كامل',
  ...SUBSCRIPTION_PLAN_FEATURES
] as const;

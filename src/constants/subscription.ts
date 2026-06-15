import type { SubscriptionPlan, SubscriptionPlanId } from '../types/app';

export const KARIMI_BANK = {
  bankName: 'بنك الكريمي للتمويل الأصغر الإسلامي',
  accountName: 'LegalMind Yemen — [اسم المكتب/الشركة]',
  accountNumber: '0000-0000-0000-0000',
  iban: 'YE00BKRM00000000000000000000',
  note: 'يرجى كتابة اسم المكتب في خانة الملاحظات عند التحويل.'
} as const;

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'الباقة التجريبية',
    price: '0',
    amountYer: 0,
    period: 'شهرياً',
    features: [
      'إدارة حتى 5 قضايا',
      'إدارة حتى 10 عملاء',
      'مساحة تخزين 1 جيجابايت',
      'دعم فني عبر البريد'
    ],
    color: 'border-slate-300'
  },
  {
    id: 'professional',
    name: 'باقة المحامي المحترف',
    price: '45,000',
    amountYer: 45000,
    period: 'شهرياً',
    features: [
      'عدد قضايا غير محدود',
      'عدد عملاء غير محدود',
      'مساحة تخزين 20 جيجابايت',
      'مزامنة مع التقويم والرسائل القصيرة',
      'دعم فني وتحديثات مستمرة',
      'صياغة ذكية للعرائض'
    ],
    color: 'border-amber-500 shadow-md ring-2 ring-amber-500/20',
    badge: 'الأكثر طلباً في اليمن'
  },
  {
    id: 'corporate',
    name: 'باقة الشركات والمكاتب والشركاء',
    price: '120,000',
    amountYer: 120000,
    period: 'شهرياً',
    features: [
      'كل ميزات الباقة المحترفة',
      'إدارة حتى 10 محامين بالشركة',
      'مساحة تخزين 100 جيجابايت',
      'صلاحيات مخصصة وتوزيع مهام تلقائي',
      'تقارير الأداء المالي والعملي المتقدمة',
      'خط ساخن مخصص للدعم الفني'
    ],
    color: 'border-indigo-800'
  }
];

export function getPlanById(id: SubscriptionPlanId): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === id);
}

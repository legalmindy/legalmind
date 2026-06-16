import type { SubscriptionPlan, SubscriptionPlanId } from '../types/app';
import { SUBSCRIPTION_PLAN_FEATURES } from './planFeatures';

export const KARIMI_BANK = {
  bankName: 'بنك الكريمي للتمويل الأصغر الإسلامي',
  accountName: 'LegalMind Yemen — [اسم المكتب/الشركة]',
  accountNumber: '0000-0000-0000-0000',
  iban: 'YE00BKRM00000000000000000000',
  note: 'يرجى كتابة اسم المكتب في خانة الملاحظات عند التحويل.'
} as const;

/** Shared features for all paid durations. */
const PAID_FEATURES = [...SUBSCRIPTION_PLAN_FEATURES];

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'monthly',
    name: 'اشتراك شهري',
    price: '6,000',
    amountYer: 6000,
    period: 'شهر واحد',
    durationDays: 30,
    features: PAID_FEATURES,
    color: 'border-slate-300'
  },
  {
    id: 'quarterly',
    name: 'اشتراك 3 أشهر',
    price: '15,000',
    amountYer: 15000,
    period: '3 أشهر',
    durationDays: 90,
    features: [...PAID_FEATURES, 'توفير مقارنة بالدفع الشهري'],
    color: 'border-amber-500 shadow-md ring-2 ring-amber-500/20',
    badge: 'الأكثر طلباً'
  },
  {
    id: 'annual',
    name: 'اشتراك سنوي',
    price: '50,000',
    amountYer: 50000,
    period: '12 شهراً',
    durationDays: 365,
    features: [...PAID_FEATURES, 'أفضل قيمة — توفير كبير'],
    color: 'border-indigo-800',
    badge: 'أفضل توفير'
  }
];

export const PLAN_LABELS: Record<SubscriptionPlanId, string> = {
  trial: 'شهر مجاني',
  monthly: 'اشتراك شهري',
  quarterly: 'اشتراك 3 أشهر',
  annual: 'اشتراك سنوي'
};

export function getPlanById(id: SubscriptionPlanId): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === id);
}

export function getPlanLabel(id: SubscriptionPlanId): string {
  return PLAN_LABELS[id] ?? id;
}

export function getPlanDurationDays(id: SubscriptionPlanId): number {
  const paid = getPlanById(id as Exclude<SubscriptionPlanId, 'trial'>);
  if (paid) return paid.durationDays;
  return 30;
}

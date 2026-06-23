export type PageId =
  | 'landing'
  | 'login'
  | 'register'
  | 'register-office'
  | 'register-lawyer'
  | 'invite'
  | 'accept-invite'
  | 'forgot'
  | 'reset-password'
  | 'dashboard'
  | 'clients'
  | 'cases'
  | 'archive'
  | 'employees'
  | 'sessions'
  | 'documents'
  | 'lawyers'
  | 'subscription'
  | 'profile'
  | 'settings'
  | 'reports'
  | 'execution'
  | 'help'
  | 'notifications'
  | 'admin-billing'
  | 'case-detail'
  | 'audit-logs'
  | 'office-manager'
  | 'data-export'
  | 'backup'
  | 'trust-security';

export type CaseDetailTab =
  | 'overview'
  | 'sessions'
  | 'documents'
  | 'financials'
  | 'payments'
  | 'receipts'
  | 'timeline'
  | 'notes'
  | 'lawyers';

export type PermissionKey =
  | 'cases.view'
  | 'cases.create'
  | 'cases.edit'
  | 'cases.delete'
  | 'clients.view'
  | 'clients.create'
  | 'clients.edit'
  | 'clients.delete'
  | 'documents.upload'
  | 'documents.download'
  | 'documents.delete'
  | 'financials.view'
  | 'financials.add_payments'
  | 'financials.print_receipts'
  | 'sessions.view'
  | 'sessions.create'
  | 'sessions.edit'
  | 'users.invite'
  | 'users.manage'
  | 'users.permissions'
  | 'subscriptions.view'
  | 'subscriptions.manage'
  | 'settings.view'
  | 'settings.edit';

export type UserRole = 'super_admin' | 'admin' | 'lawyer' | 'assistant' | 'firm_manager';
export type CustomerType = 'شركة تجارية' | 'فرد';
export type DocumentType = 'pdf' | 'docx' | 'xlsx' | 'jpg' | 'png' | 'webp';
export type NotificationType = 'session' | 'document' | 'case';
export type AlertType = 'success' | 'error' | 'info';
export type CaseType = 'مدنية' | 'تجارية' | 'أحوال شخصية' | 'عمالية' | 'مستعجلة' | 'جنائية';
export type CaseStage = 'ابتدائي مدني' | 'ابتدائي شخصي' | 'ابتدائي جنائي' | 'استئناف' | 'نقض';
export type CaseStatus = 'active' | 'archived' | 'closed';
export type SessionStatus = 'مجدولة' | 'منعقدة' | 'مؤجلة' | 'ملغاة' | 'منتهية';
export type EmployeeStatus = 'active' | 'suspended' | 'disabled' | 'pending_approval';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** Arabic display name from firm role template (e.g. سكرتير). */
  roleLabel?: string;
  plan: string;
  company: string;
  phone: string;
  licenseNo: string;
  image?: string;
}

export interface Office {
  id: string;
  name: string;
  licenseNo: string;
  plan: string;
  firmCode?: string;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionPlan?: SubscriptionPlanId;
  subscriptionExpiresAt?: string | null;
  isLocked?: boolean;
  remindersEnabled?: boolean;
  whatsappReportsEnabled?: boolean;
  smsReportsEnabled?: boolean;
  hideFinancialsFromTrainees?: boolean;
}

export type ExecutionRequestStatus = 'pending' | 'in_progress' | 'completed' | 'rejected';

export interface ExecutionRequest {
  id: string;
  clientId?: string;
  clientName?: string;
  caseId?: string;
  caseTitle?: string;
  title: string;
  court: string;
  requestNumber: string;
  status: ExecutionRequestStatus;
  notes?: string;
  dueDate?: string;
  createdAt: string;
}

export type ClientReportChannel = 'whatsapp' | 'sms';

export const EXPENSE_CATEGORIES = [
  'إيجار', 'رواتب', 'قرطاسية ومستلزمات مكتبية', 'اتصالات وإنترنت',
  'رسوم قضائية', 'تسويق وإعلان', 'صيانة وتجهيزات', 'مواصلات', 'أخرى'
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number] | string;

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  expense_date: string;
  notes?: string;
  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  type: CustomerType;
  casesCount: number;
  createdAt: string;
}

export interface CaseRecord {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  assignedLawyerId?: string;
  court_case_number: string;
  case_type: CaseType;
  category: string;
  case_stage: CaseStage;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  contract_currency?: string;
  contract_date?: string;
  status: CaseStatus;
  judgment_date?: string;
  archive_date?: string;
  closed_by?: string;
  notes?: string;
  court: string;
  caseNo: string;
  lawyerId: string;
  lawyerName?: string;
  dateStarted: string;
  description: string;
}

export interface SessionItem {
  id: string;
  caseId: string;
  caseTitle: string;
  court: string;
  date: string;
  time: string;
  status: SessionStatus;
  type: string;
  notes: string;
  judgeName?: string;
  nextSessionDate?: string;
  sessionOutcome?: string;
}

export interface CasePayment {
  id: string;
  caseId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  notes?: string;
  receiptStoragePath?: string;
  receiptFileName?: string;
  createdAt: string;
}

export interface CaseFinancialSummary {
  contractTotal: number;
  totalPaid: number;
  remaining: number;
  paymentPercentage: number;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  currency: string;
  contractDate?: string;
}

export interface ReceiptVoucher {
  id: string;
  caseId: string;
  casePaymentId: string;
  receiptNumber: string;
  amount: number;
  clientName?: string;
  caseNumber?: string;
  contractTotal?: number;
  remainingBalance?: number;
  paymentMethod?: string;
  notes?: string;
  qrPayload?: string;
  printedAt: string;
  reprintCount: number;
  caseTitle?: string;
  printedByName?: string;
}

export interface CaseTimelineEvent {
  id: string;
  eventType: string;
  title: string;
  details?: string;
  metadata?: Record<string, unknown>;
  actorName?: string;
  createdAt: string;
}

export interface FirmRole {
  id: string;
  name: string;
  slug: string;
  isTemplate: boolean;
  permissions: Record<string, boolean>;
}

export interface DocumentItem {
  id: string;
  title: string;
  caseId: string;
  caseTitle: string;
  category: string;
  size: string;
  dateUploaded: string;
  url: string;
}

export interface Employee {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  firm_role_id?: string;
  firmRoleName?: string;
  firmRoleSlug?: string;
  status: EmployeeStatus;
  profile_image?: string;
  created_at: string;
}

export interface Invitation {
  id: string;
  firmId?: string;
  officeId?: string;
  email: string;
  fullName: string;
  phone: string;
  role: Extract<UserRole, 'admin' | 'lawyer' | 'assistant'>;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'revoked';
  invitedBy?: string;
  employeeId?: string;
  expiresAt: string;
  acceptedAt?: string;
  inviteUrl?: string;
  createdAt: string;
}

export interface Lawyer {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  specialization: string;
  success_rate?: number;
  attendance_rate?: number;
  total_cases?: number;
  won_cases?: number;
  attended_sessions?: number;
  missed_sessions?: number;
}

export interface CaseAttachment {
  id: string;
  case_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  uploaded_by?: string;
  uploaded_at: string;
  version: number;
  notes?: string;
}

export type SubscriptionPlanId = 'trial' | 'monthly' | 'quarterly' | 'annual';
export type SubscriptionStatus = 'trial' | 'active' | 'expired';
export type SubscriptionRequestStatus = 'pending' | 'approved' | 'rejected';
export type SaasPlanType = 'monthly' | 'quarterly' | 'yearly';
export type SaasSubscriptionStatus = 'pending' | 'active' | 'expired' | 'cancelled';
export type PaymentStatus = 'pending' | 'approved' | 'rejected';

export interface FirmSubscription {
  firmId: string;
  status: SubscriptionStatus;
  plan: SubscriptionPlanId;
  expiresAt: string | null;
  isLocked: boolean;
  isActive: boolean;
  legacyPlan?: string;
}

export interface SubscriptionRequest {
  id: string;
  firmId: string;
  plan: SubscriptionPlanId;
  amountYer: number;
  transferReference: string;
  receiptPath: string;
  receiptUrl?: string;
  status: SubscriptionRequestStatus;
  adminNotes?: string;
  createdAt: string;
  reviewedAt?: string;
  subscriptionId?: string;
  paymentId?: string;
}

export interface SaasSubscription {
  id: string;
  firmId: string;
  planType: SaasPlanType;
  status: SaasSubscriptionStatus;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  firmId: string;
  subscriptionId: string;
  amount: number;
  paymentMethod: string;
  receiptUrl?: string;
  proofOfPaymentUrl?: string;
  status: PaymentStatus;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  transferReference?: string;
  receiptPath?: string;
  planType?: SaasPlanType;
  firmName?: string;
  requestId?: string;
  planLabel?: string;
}

export interface PlatformBankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  note: string;
}

export interface PlanFeature {
  label: string;
  description?: string;
  group?: string;
  highlight?: boolean;
}

export interface SubscriptionPlan {
  id: Exclude<SubscriptionPlanId, 'trial'>;
  name: string;
  tagline?: string;
  price: string;
  amountYer: number;
  period: string;
  durationDays: number;
  monthlyEquivalent?: string;
  savingsLabel?: string;
  features: PlanFeature[];
  color: string;
  badge?: string;
}

export interface ChartPoint {
  month: string;
  cases: number;
  resolved: number;
  revenue: number;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: NotificationType;
}

export interface AlertState {
  type: AlertType;
  text: string;
}

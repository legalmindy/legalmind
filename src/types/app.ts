export type PageId =
  | 'landing'
  | 'login'
  | 'register'
  | 'register-office'
  | 'register-lawyer'
  | 'invite'
  | 'accept-invite'
  | 'forgot'
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
  | 'help'
  | 'notifications';

export type UserRole = 'super_admin' | 'admin' | 'lawyer' | 'assistant' | 'firm_manager';
export type CustomerType = 'شركة تجارية' | 'فرد';
export type DocumentType = 'pdf' | 'docx' | 'xlsx' | 'jpg' | 'png' | 'webp';
export type NotificationType = 'session' | 'document' | 'case';
export type AlertType = 'success' | 'error' | 'info';
export type CaseType = 'مدنية' | 'تجارية' | 'أحوال شخصية' | 'عمالية' | 'مستعجلة' | 'جنائية';
export type CaseStage = 'ابتدائي مدني' | 'ابتدائي شخصي' | 'ابتدائي جنائي' | 'استئناف' | 'نقض';
export type CaseStatus = 'active' | 'archived' | 'closed';
export type EmployeeStatus = 'active' | 'suspended' | 'disabled';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
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
  status: string;
  judgment_date?: string;
  archive_date?: string;
  closed_by?: string;
  notes?: string;
  court: string;
  caseNo: string;
  lawyerId: string;
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
  status: string;
  type: string;
  notes: string;
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

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  features: string[];
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

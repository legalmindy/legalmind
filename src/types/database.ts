import type {
  CaseStage,
  CaseStatus,
  CaseType,
  CustomerType,
  DocumentType,
  EmployeeStatus,
  NotificationType,
  UserRole
} from './app';

export interface DbFirm {
  id: string;
  name: string;
  license_no: string | null;
  firm_code?: string | null;
  owner_full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  plan: string;
  subscription_status?: string;
  subscription_plan?: string;
  subscription_expires_at?: string | null;
  is_locked?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface DbProfile {
  id: string;
  firm_id: string;
  employee_id: string | null;
  full_name: string;
  email: string;
  role: 'admin' | 'lawyer' | 'assistant';
  phone: string | null;
  profile_image: string | null;
  license_no: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  firms?: DbFirm | null;
}

export interface DbEmployee {
  id: string;
  auth_uid: string | null;
  firm_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: EmployeeStatus;
  profile_image: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DbClient {
  id: string;
  firm_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  type: CustomerType;
  cases_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DbCase {
  id: string;
  firm_id: string;
  client_id: string;
  assigned_lawyer_id: string | null;
  court_case_number: string;
  title: string;
  case_type: CaseType;
  case_stage: CaseStage;
  category: string;
  court: string;
  description: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: CaseStatus;
  judgment_date: string | null;
  archive_date: string | null;
  closed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  clients?: { name: string } | null;
  assigned_lawyer?: {
    id: string;
    employee?: { full_name: string } | { full_name: string }[] | null;
  } | null;
}

export interface DbSession {
  id: string;
  case_id: string;
  scheduled_by: string | null;
  court: string;
  session_date: string;
  session_time: string;
  status: string;
  session_type: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  cases?: { title: string } | null;
}

export interface DbDocument {
  id: string;
  case_id: string | null;
  uploaded_by: string | null;
  title: string;
  category: string;
  file_type: DocumentType;
  file_size: number;
  storage_path: string;
  url: string | null;
  uploaded_at: string;
  updated_at: string;
  deleted_at: string | null;
  cases?: { title: string } | null;
}

export interface DbLawyer {
  id: string;
  employee_id: string;
  specialization: string | null;
  success_rate: number | null;
  attendance_rate: number | null;
  total_cases: number | null;
  won_cases: number | null;
  attended_sessions: number | null;
  missed_sessions: number | null;
  created_at: string;
  updated_at: string;
  employees?: DbEmployee | null;
}

export interface DbNotification {
  id: string;
  firm_id: string;
  employee_id: string | null;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  created_at: string;
}

export interface DbInvitation {
  id: string;
  firm_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: Extract<UserRole, 'admin' | 'lawyer' | 'assistant'>;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'revoked';
  invited_by: string | null;
  employee_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  invite_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbInvitationPreview {
  id: string;
  firm_id: string;
  office_name?: string;
  firm_name: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: Extract<UserRole, 'admin' | 'lawyer' | 'assistant'>;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled' | 'revoked';
  expires_at: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

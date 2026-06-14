import type {
  CaseRecord,
  Client,
  DocumentItem,
  Employee,
  Invitation,
  Lawyer,
  NotificationItem,
  Office,
  SessionItem,
  User
} from '../types/app';
import type {
  DbCase,
  DbClient,
  DbDocument,
  DbEmployee,
  DbFirm,
  DbInvitation,
  DbLawyer,
  DbNotification,
  DbSession
} from '../types/database';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export function mapDbClient(row: DbClient): Client {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    type: row.type,
    casesCount: row.cases_count,
    createdAt: row.created_at.split('T')[0] ?? row.created_at
  };
}

export function mapDbCase(row: DbCase): CaseRecord {
  return {
    id: row.id,
    title: row.title,
    clientId: row.client_id,
    clientName: row.clients?.name ?? 'غير محدد',
    assignedLawyerId: row.assigned_lawyer_id ?? undefined,
    court_case_number: row.court_case_number,
    case_type: row.case_type,
    category: row.category,
    case_stage: row.case_stage,
    total_amount: row.total_amount,
    paid_amount: row.paid_amount,
    remaining_amount: row.remaining_amount,
    status: row.status,
    judgment_date: row.judgment_date ?? undefined,
    archive_date: row.archive_date ?? undefined,
    closed_by: row.closed_by ?? undefined,
    notes: row.notes ?? undefined,
    court: row.court,
    caseNo: row.court_case_number,
    lawyerId: row.assigned_lawyer_id ?? '',
    dateStarted: row.created_at.split('T')[0] ?? row.created_at,
    description: row.description ?? ''
  };
}

export function mapDbSession(row: DbSession): SessionItem {
  return {
    id: row.id,
    caseId: row.case_id,
    caseTitle: row.cases?.title ?? 'قضية مجهولة',
    court: row.court,
    date: row.session_date,
    time: row.session_time.slice(0, 5),
    status: row.status,
    type: row.session_type ?? '',
    notes: row.notes ?? ''
  };
}

export function mapDbDocument(row: DbDocument): DocumentItem {
  return {
    id: row.id,
    title: row.title,
    caseId: row.case_id ?? '',
    caseTitle: row.cases?.title ?? 'قضية عامة',
    category: row.category,
    size: formatFileSize(row.file_size),
    dateUploaded: row.uploaded_at.split('T')[0] ?? row.uploaded_at,
    url: row.url ?? '#'
  };
}

export function mapDbEmployee(row: DbEmployee): Employee {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone ?? '',
    role: row.role,
    status: row.status,
    profile_image: row.profile_image ?? undefined,
    created_at: row.created_at
  };
}

export function mapDbLawyer(row: DbLawyer): Lawyer {
  const emp = row.employees;
  return {
    id: row.id,
    name: emp?.full_name ?? 'محامٍ',
    role: emp?.role ?? 'lawyer',
    email: emp?.email ?? '',
    phone: emp?.phone ?? '',
    specialization: row.specialization ?? 'عام',
    success_rate: row.success_rate ?? undefined,
    attendance_rate: row.attendance_rate ?? undefined,
    total_cases: row.total_cases ?? undefined,
    won_cases: row.won_cases ?? undefined,
    attended_sessions: row.attended_sessions ?? undefined,
    missed_sessions: row.missed_sessions ?? undefined
  };
}

export function mapDbNotification(row: DbNotification): NotificationItem {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    time: formatRelativeTime(row.created_at),
    read: row.read,
    type: row.type
  };
}

export function mapDbFirm(row: DbFirm): Office {
  return {
    id: row.id,
    name: row.name,
    licenseNo: row.license_no ?? '',
    plan: row.plan,
    firmCode: row.firm_code ?? undefined
  };
}

export function mapDbInvitation(row: DbInvitation): Invitation {
  return {
    id: row.id,
    firmId: row.firm_id ?? undefined,
    officeId: row.firm_id ?? undefined,
    email: row.email,
    fullName: row.full_name ?? '',
    phone: row.phone ?? '',
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by ?? undefined,
    employeeId: row.employee_id ?? undefined,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at ?? undefined,
    inviteUrl: row.invite_url ?? undefined,
    createdAt: row.created_at
  };
}

export function mapEmployeeToUser(
  employee: DbEmployee,
  firmName: string,
  plan: string
): User {
  return {
    id: employee.id,
    name: employee.full_name,
    email: employee.email,
    role: employee.role,
    plan,
    company: firmName,
    phone: employee.phone ?? '',
    licenseNo: '',
    image: employee.profile_image ?? undefined
  };
}

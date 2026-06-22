import { lazy, Suspense } from 'react';
import { PageLoader } from '../ui/LoadingSpinner';
import { canManageOffice, getDocumentDownloadUrl } from '../../lib/api';
import { toArabicQueryError } from '../QueryErrorBanner';
import { canAccessCaseDetail, hasPermission } from '../../lib/permissions';
import { updateUserProfile, uploadProfileAvatar } from '../../lib/profileImage';
import {
  initialCaseForm,
  initialClientForm,
  initialEmployeeForm,
  initialSessionForm
} from '../../app/workspaceForms';
import type { AuthContextValue } from '../../contexts/AuthContext';
import type {
  AlertState,
  CaseDetailTab,
  CaseRecord,
  Client,
  DocumentItem,
  Employee,
  Invitation,
  Lawyer,
  Office,
  PageId,
  SessionItem,
  User
} from '../../types/app';
import type {
  DashboardFinancials,
  DashboardPerformance,
  DashboardStatHints
} from '../../lib/dashboardAnalytics';

const LandingPage = lazy(() => import('../../pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const AuthPages = lazy(() => import('../../pages/AuthPages').then((m) => ({ default: m.AuthPages })));
const ArchivePage = lazy(() => import('../../pages/ArchivePage').then((m) => ({ default: m.ArchivePage })));
const EmployeesPage = lazy(() => import('../../pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const ExecutionRequestsPage = lazy(() => import('../../pages/ExecutionRequestsPage').then((m) => ({ default: m.ExecutionRequestsPage })));
const AdminSubscriptionPage = lazy(() => import('../../pages/AdminSubscriptionPage').then((m) => ({ default: m.AdminSubscriptionPage })));
const CaseDetailPage = lazy(() => import('../../pages/CaseDetailPage').then((m) => ({ default: m.CaseDetailPage })));
const AuditLogsPage = lazy(() => import('../../pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const DashboardPage = lazy(() => import('../../pages/workspace/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ClientsPage = lazy(() => import('../../pages/workspace/ClientsPage').then((m) => ({ default: m.ClientsPage })));
const CasesPage = lazy(() => import('../../pages/workspace/CasesPage').then((m) => ({ default: m.CasesPage })));
const SessionsPage = lazy(() => import('../../pages/workspace/SessionsPage').then((m) => ({ default: m.SessionsPage })));
const DocumentsPage = lazy(() => import('../../pages/workspace/DocumentsPage').then((m) => ({ default: m.DocumentsPage })));
const LawyersPage = lazy(() => import('../../pages/workspace/LawyersPage').then((m) => ({ default: m.LawyersPage })));
const ReportsPage = lazy(() => import('../../pages/workspace/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SubscriptionPage = lazy(() => import('../../pages/workspace/SubscriptionPage').then((m) => ({ default: m.SubscriptionPage })));
const ProfilePage = lazy(() => import('../../pages/workspace/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('../../pages/workspace/SettingsPage').then((m) => ({ default: m.SettingsPage })));
type WorkspaceAuthHandlers = Pick<
  AuthContextValue,
  | 'login'
  | 'register'
  | 'registerOffice'
  | 'registerLawyer'
  | 'registerInvitedUser'
  | 'forgotPassword'
  | 'verifyMfa'
  | 'resendVerification'
  | 'refreshUser'
  | 'isConfigured'
>;

export interface WorkspaceRoutesProps {
  currentPage: PageId;
  isAuth: boolean;
  pageLoading: boolean;
  user: User | null;
  selectedCaseId: string | null;
  employeesSection: 'team' | 'manager';
  clients: Client[];
  cases: CaseRecord[];
  filteredClients: Client[];
  filteredCases: CaseRecord[];
  sessions: SessionItem[];
  documents: DocumentItem[];
  lawyers: Lawyer[];
  employees: Employee[];
  invitations: Invitation[];
  archivedCases: CaseRecord[];
  office?: Office;
  firmCode?: string;
  firmName?: string;
  whatsappReportsEnabled: boolean;
  smsReportsEnabled: boolean;
  canSendClientReport: boolean;
  remindersEnabled: boolean;
  isBillingAdmin: boolean;
  isBillingAdminLoading: boolean;
  currentUserLawyerId: string;
  stats: {
    totalClients: number;
    totalCases: number;
    activeCases: number;
    upcomingSessions: number;
    totalDocuments: number;
    lawyersCount: number;
  };
  monthlyData: { month: string; cases: number; resolved: number; revenue: number }[];
  dashboardPerformance: DashboardPerformance;
  dashboardFinancials: DashboardFinancials;
  dashboardStatHints: DashboardStatHints;
  permissions?: Record<string, boolean>;
  activeChartTab: 'cases' | 'revenue';
  hoveredDataPoint: { month: string; cases: number; resolved: number; revenue: number } | null;
  searchQuery: string;
  statusFilter: string;
  categoryFilter: string;
  setActiveChartTab: (tab: 'cases' | 'revenue') => void;
  setHoveredDataPoint: (data: { month: string; cases: number; resolved: number; revenue: number } | null) => void;
  setSearchQuery: (value: string) => void;
  setStatusFilter: (value: string) => void;
  setCategoryFilter: (value: string) => void;
  setShowClientModal: (value: boolean) => void;
  setShowCaseModal: (value: boolean) => void;
  setShowSessionModal: (value: boolean) => void;
  setShowDocumentModal: (value: boolean) => void;
  setShowEmployeeModal: (value: boolean) => void;
  setEditingClient: (client: Client | null) => void;
  setEditingCase: (caseRecord: CaseRecord | null) => void;
  setEditingSession: (session: SessionItem | null) => void;
  setEditingEmployee: (employee: Employee | null) => void;
  setNewClient: (form: typeof initialClientForm) => void;
  setNewCase: (form: typeof initialCaseForm) => void;
  setNewSession: (form: typeof initialSessionForm) => void;
  setNewEmployee: (form: typeof initialEmployeeForm) => void;
  setReportClient: (client: Client | null) => void;
  setPaymentReminderCase: (caseRecord: CaseRecord | null) => void;
  navigateToPage: (page: PageId) => void;
  navigateToCaseDetail: (caseId: string, initialTab?: CaseDetailTab) => void;
  showAlert: (text: string, type?: AlertState['type']) => void;
  deleteClient: (id: string) => Promise<void>;
  deleteCase: (id: string) => Promise<void>;
  openArchiveCase: (caseRecord: CaseRecord) => void;
  deleteSession: (id: string) => Promise<void>;
  auth: WorkspaceAuthHandlers;
  caseMutations: {
    restoreCase: { mutateAsync: (id: string) => Promise<unknown> };
  };
  employeeMutations: {
    deleteEmployee: { mutateAsync: (id: string) => Promise<unknown> };
    toggleEmployeeStatus: { mutateAsync: (input: { id: string; status: 'active' | 'suspended' }) => Promise<unknown> };
    revokeInvitation: { mutateAsync: (id: string) => Promise<unknown> };
    resendInvitation: { mutateAsync: (id: string) => Promise<unknown> };
  };
  officeMutations: {
    updateOffice: { mutateAsync: (office: Office) => Promise<unknown> };
  };
}

function RouteFallback() {
  return <PageLoader />;
}

export function WorkspaceRoutes(props: WorkspaceRoutesProps) {
  const {
    currentPage,
    isAuth,
    pageLoading,
    user,
    selectedCaseId,
    employeesSection,
    clients,
    cases,
    filteredClients,
    filteredCases,
    sessions,
    documents,
    lawyers,
    employees,
    invitations,
    archivedCases,
    office,
    firmCode,
    firmName,
    whatsappReportsEnabled,
    canSendClientReport,
    remindersEnabled,
    isBillingAdmin,
    isBillingAdminLoading,
    currentUserLawyerId,
    stats,
    monthlyData,
    dashboardPerformance,
    dashboardFinancials,
    dashboardStatHints,
    permissions,
    activeChartTab,
    hoveredDataPoint,
    searchQuery,
    statusFilter,
    categoryFilter,
    setActiveChartTab,
    setHoveredDataPoint,
    setSearchQuery,
    setStatusFilter,
    setCategoryFilter,
    setShowClientModal,
    setShowCaseModal,
    setShowSessionModal,
    setShowDocumentModal,
    setShowEmployeeModal,
    setEditingClient,
    setEditingCase,
    setEditingSession,
    setEditingEmployee,
    setNewClient,
    setNewCase,
    setNewSession,
    setNewEmployee,
    setReportClient,
    setPaymentReminderCase,
    navigateToPage,
    navigateToCaseDetail,
    showAlert,
    deleteClient,
    deleteCase,
    openArchiveCase,
    deleteSession,
    auth,
    caseMutations,
    employeeMutations,
    officeMutations
  } = props;

  return (
    <Suspense fallback={<RouteFallback />}>
      {currentPage === 'landing' && <LandingPage onNavigate={navigateToPage} />}

      {(currentPage === 'login' || currentPage === 'register' || currentPage === 'register-office' || currentPage === 'register-lawyer' || currentPage === 'invite' || currentPage === 'forgot' || currentPage === 'accept-invite') && (
        <AuthPages
          currentPage={currentPage}
          onNavigate={navigateToPage}
          onLogin={auth.login}
          onRegister={auth.register}
          onRegisterOffice={auth.registerOffice}
          onRegisterLawyer={auth.registerLawyer}
          onRegisterInvitedUser={auth.registerInvitedUser}
          onForgotPassword={auth.forgotPassword}
          onVerifyMfa={auth.verifyMfa}
          onResendVerification={auth.resendVerification}
          isConfigured={auth.isConfigured}
        />
      )}

      {pageLoading && isAuth && currentPage !== 'landing' && currentPage !== 'login' && <PageLoader />}

      {currentPage === 'dashboard' && user && !pageLoading && (
        <DashboardPage
          user={user}
          permissions={permissions}
          role={user.role}
          sessions={sessions}
          documents={documents}
          activeChartTab={activeChartTab}
          hoveredDataPoint={hoveredDataPoint}
          setActiveChartTab={setActiveChartTab}
          setHoveredDataPoint={setHoveredDataPoint}
          stats={stats}
          monthlyData={monthlyData}
          performance={dashboardPerformance}
          financials={dashboardFinancials}
          statHints={dashboardStatHints}
          setCurrentPage={navigateToPage}
          setShowClientModal={setShowClientModal}
          setShowCaseModal={(v) => {
            if (v) {
              setEditingCase(null);
              setNewCase({ ...initialCaseForm, lawyerId: currentUserLawyerId });
            }
            setShowCaseModal(v);
          }}
          setShowSessionModal={setShowSessionModal}
          office={office}
          remindersEnabled={remindersEnabled}
          onFirmCodeCopied={(msg) => showAlert(msg, 'success')}
        />
      )}

      {currentPage === 'clients' && user && !pageLoading && (
        <ClientsPage
          clients={filteredClients}
          searchQuery={searchQuery}
          onSearch={setSearchQuery}
          onCreateClient={() => {
            setEditingClient(null);
            setNewClient(initialClientForm);
            setShowClientModal(true);
          }}
          onEditClient={(c) => {
            setEditingClient(c);
            setNewClient({ name: c.name, phone: c.phone, email: c.email, address: c.address, type: c.type });
            setShowClientModal(true);
          }}
          onDeleteClient={(id) => void deleteClient(id)}
          canSendReport={canSendClientReport}
          onSendReport={(c) => setReportClient(c)}
        />
      )}

      {currentPage === 'execution' && user && !pageLoading && (
        <ExecutionRequestsPage
          clients={clients}
          cases={cases}
          onNotify={(message, type = 'info') => showAlert(message, type)}
        />
      )}

      {currentPage === 'cases' && user && !pageLoading && (
        <CasesPage
          cases={filteredCases}
          searchQuery={searchQuery}
          statusFilter={statusFilter}
          categoryFilter={categoryFilter}
          onSearch={setSearchQuery}
          onStatusFilterChange={setStatusFilter}
          onCategoryFilterChange={setCategoryFilter}
          onCreateCase={() => {
            setEditingCase(null);
            setNewCase({ ...initialCaseForm, lawyerId: currentUserLawyerId });
            setShowCaseModal(true);
          }}
          onEditCase={(cr) => {
            setEditingCase(cr);
            setNewCase({
              title: cr.title,
              clientId: cr.clientId,
              category: cr.category,
              case_type: cr.case_type,
              case_stage: cr.case_stage,
              court_case_number: cr.court_case_number,
              total_amount: cr.total_amount,
              paid_amount: cr.paid_amount,
              remaining_amount: cr.remaining_amount,
              status: cr.status,
              court: cr.court,
              caseNo: cr.caseNo,
              lawyerId: cr.lawyerId,
              description: cr.description,
              notes: cr.notes ?? ''
            });
            setShowCaseModal(true);
          }}
          onViewCase={(cr) => {
            const financialOnly =
              Boolean(user) &&
              canAccessCaseDetail(permissions, user.role) &&
              !hasPermission(permissions, 'cases.edit', user.role);
            navigateToCaseDetail(cr.id, financialOnly ? 'payments' : undefined);
          }}
          onArchiveCase={openArchiveCase}
          onDeleteCase={(id) => void deleteCase(id)}
          canSendPaymentReminder={whatsappReportsEnabled}
          onSendPaymentReminder={(cr) => setPaymentReminderCase(cr)}
          canViewCase360={Boolean(user && canAccessCaseDetail(permissions, user.role))}
          permissions={permissions}
          userRole={user?.role}
        />
      )}

      {currentPage === 'case-detail' && user && selectedCaseId && canAccessCaseDetail(permissions, user.role) && (
        <CaseDetailPage
          caseId={selectedCaseId}
          user={user}
          firmName={firmName ?? user.company}
          sessions={sessions}
          documents={documents}
          onBack={() => navigateToPage('cases')}
          onCreateSession={(caseId) => {
            setEditingSession(null);
            setNewSession({ ...initialSessionForm, caseId });
            setShowSessionModal(true);
          }}
          onEditSession={(s) => {
            setEditingSession(s);
            setNewSession({
              caseId: s.caseId,
              court: s.court,
              date: s.date,
              time: s.time,
              status: s.status,
              type: s.type,
              notes: s.notes,
              judgeName: s.judgeName ?? '',
              nextSessionDate: s.nextSessionDate ?? '',
              sessionOutcome: s.sessionOutcome ?? ''
            });
            setShowSessionModal(true);
          }}
          onNotify={(message, type = 'info') => showAlert(message, type)}
        />
      )}

      {currentPage === 'archive' && user && !pageLoading && (
        <ArchivePage
          cases={archivedCases}
          onRestore={(id) =>
            void caseMutations.restoreCase
              .mutateAsync(id)
              .then(() => showAlert('تمت استعادة القضية.', 'success'))
              .catch((err) => showAlert(toArabicQueryError(err, 'استعادة القضية'), 'error'))
          }
          onPermanentArchive={(id) => void deleteCase(id)}
        />
      )}

      {currentPage === 'employees' && user && !pageLoading && (
        <EmployeesPage
          employees={employees}
          invitations={invitations}
          onInvite={() => {
            setEditingEmployee(null);
            setNewEmployee(initialEmployeeForm);
            setShowEmployeeModal(true);
          }}
          onDelete={async (id) => {
            if (!window.confirm('حذف هذا الموظف من المكتب؟')) return;
            try {
              await employeeMutations.deleteEmployee.mutateAsync(id);
              showAlert('تم حذف الموظف.', 'info');
            } catch (err) {
              showAlert(toArabicQueryError(err, 'حذف الموظف'), 'error');
            }
          }}
          onToggleStatus={async (id) => {
            const emp = employees.find((e) => e.id === id);
            if (!emp) return;
            try {
              await employeeMutations.toggleEmployeeStatus.mutateAsync({
                id,
                status: emp.status === 'active' ? 'suspended' : 'active'
              });
              showAlert(emp.status === 'active' ? 'تم تعليق الموظف.' : 'تم تفعيل الموظف.', 'success');
            } catch (err) {
              showAlert(toArabicQueryError(err, 'تحديث الحالة'), 'error');
            }
          }}
          onEdit={(employee) => {
            setEditingEmployee(employee);
            setNewEmployee({
              full_name: employee.full_name,
              email: employee.email,
              phone: employee.phone,
              role: employee.role,
              firm_role_id: employee.firm_role_id ?? '',
              status: employee.status,
              profile_image: employee.profile_image
            });
            setShowEmployeeModal(true);
          }}
          onRevokeInvitation={async (id) => {
            if (!window.confirm('إلغاء هذه الدعوة؟ لن يتمكن المدعو من استخدام الرابط.')) return;
            try {
              await employeeMutations.revokeInvitation.mutateAsync(id);
              showAlert('تم إلغاء الدعوة.', 'info');
            } catch (err) {
              showAlert(toArabicQueryError(err, 'إلغاء الدعوة'), 'error');
            }
          }}
          onResendInvitation={async (id) => {
            try {
              await employeeMutations.resendInvitation.mutateAsync(id);
              showAlert('تم تجديد رابط الدعوة.', 'success');
            } catch (err) {
              showAlert(toArabicQueryError(err, 'إعادة الإرسال'), 'error');
            }
          }}
          onCopyInvitation={(url) =>
            void navigator.clipboard
              .writeText(url)
              .then(() => showAlert('تم نسخ رابط الدعوة.', 'success'))
              .catch(() => showAlert('تعذر نسخ الرابط.', 'error'))
          }
          firmCode={firmCode}
          firmName={firmName}
          onFirmCodeCopied={(msg) => showAlert(msg, 'success')}
          userRole={user.role}
          cases={cases}
          lawyers={lawyers}
          initialSection={employeesSection}
          onNotify={(message, type = 'info') => showAlert(message, type)}
        />
      )}

      {currentPage === 'sessions' && user && !pageLoading && (
        <SessionsPage
          sessions={sessions}
          onCreateSession={() => {
            setEditingSession(null);
            setNewSession(initialSessionForm);
            setShowSessionModal(true);
          }}
          onEditSession={(s) => {
            setEditingSession(s);
            setNewSession({
              caseId: s.caseId,
              court: s.court,
              date: s.date,
              time: s.time,
              status: s.status,
              type: s.type,
              notes: s.notes,
              judgeName: s.judgeName ?? '',
              nextSessionDate: s.nextSessionDate ?? '',
              sessionOutcome: s.sessionOutcome ?? ''
            });
            setShowSessionModal(true);
          }}
          onDeleteSession={(id) => void deleteSession(id)}
        />
      )}

      {currentPage === 'documents' && user && !pageLoading && (
        <DocumentsPage
          documents={documents}
          onCreateDocument={() => setShowDocumentModal(true)}
          onGetUrl={(docId) => getDocumentDownloadUrl(docId)}
        />
      )}

      {currentPage === 'lawyers' && user && !pageLoading && <LawyersPage lawyers={lawyers} />}

      {currentPage === 'reports' && user && !pageLoading && (
        <ReportsPage
          role={user.role}
          permissions={permissions}
          performance={dashboardPerformance}
          financials={dashboardFinancials}
          cases={cases}
          onOpenCaseFinance={(caseId) => navigateToCaseDetail(caseId, 'payments')}
        />
      )}

      {currentPage === 'subscription' && user && <SubscriptionPage />}

      {currentPage === 'admin-billing' && user && (isBillingAdmin || isBillingAdminLoading) && (
        <AdminSubscriptionPage onNotify={(message, type = 'info') => showAlert(message, type)} />
      )}

      {currentPage === 'profile' && user && (
        <ProfilePage
          user={user}
          onUploadAvatar={async (file) => uploadProfileAvatar(file, user.id)}
          onSave={async (input) => {
            await updateUserProfile(input);
            await auth.refreshUser();
          }}
        />
      )}

      {currentPage === 'settings' && user && (
        <SettingsPage
          user={user}
          office={office}
          onSaveOffice={(payload) =>
            void officeMutations.updateOffice
              .mutateAsync(payload)
              .then(() => showAlert('تم تحديث بيانات المكتب.', 'success'))
              .catch((err) => showAlert(toArabicQueryError(err, 'تحديث بيانات المكتب'), 'error'))
          }
          onFirmCodeCopied={(msg) => showAlert(msg, 'success')}
          onOpenAuditLogs={() => navigateToPage('audit-logs')}
        />
      )}

      {currentPage === 'audit-logs' && user && canManageOffice(user.role) && <AuditLogsPage />}
    </Suspense>
  );
}

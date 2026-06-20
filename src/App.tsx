import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './contexts/AuthContext';
import { useToggle } from './hooks/useToggle';
import { useOfflineSync } from './hooks/useOfflineSync';
import { HeaderBar } from './components/HeaderBar';
import { SyncStatusBar } from './components/SyncStatusBar';
import { AlertBanner } from './components/AlertBanner';
import { PageLoader } from './components/ui/LoadingSpinner';
import { ClientModal, CaseModal, SessionModal, DocumentModal, EmployeeModal, ArchiveCaseModal } from './components/Modals';
import { isValidYemeniPhone } from './utils/format';
import { isValidEmail } from './lib/sanitize';
import { canManageCases, canManageClients, canManageOffice, checkRoleAccess, getDocumentDownloadUrl } from './lib/api';
import { formatCaseSaveError } from './lib/supabaseQueryHelpers';
import {
  buildFinancialSummary,
  buildMonthlyChartData,
  buildPerformanceMetrics,
  buildStatHints
} from './lib/dashboardAnalytics';
import type { ChartPoint } from './types/app';
import {
  useArchivedCases,
  useCaseMutations,
  useCases,
  useClientMutations,
  useClients,
  useDocumentMutations,
  useDocuments,
  useEmployeeMutations,
  useEmployees,
  useInvitations,
  useLawyers,
  useNotificationMutations,
  useNotifications,
  useOffice,
  useOfficeMutations,
  useFirmProfile,
  useRealtimeNotifications,
  useSessionMutations,
  useSessions,
  useUpcomingSessions,
  queryKeys
} from './hooks/useSupabaseQueries';
import { useNotificationPermission, useSessionReminders } from './hooks/useSessionReminders';
import type {
  AlertState,
  CaseRecord,
  Client,
  Employee,
  Invitation,
  PageId,
  SessionItem,
  UserRole
} from './types/app';
import { testSupabaseConnection } from './lib/testSupabaseConnection';
import { updateUserProfile, uploadProfileAvatar } from './lib/profileImage';
import { SubscriptionGuard } from './components/SubscriptionGuard';
import { ClientReportModal } from './components/ClientReportModal';
import { InvitationLinkModal } from './components/InvitationLinkModal';
import { PaymentReminderModal } from './components/PaymentReminderModal';
import { QueryErrorBanner, toArabicQueryError } from './components/QueryErrorBanner';
import { isBillingAdminAccess, isSuperAdminRole, resolvePageFromLocation, syncLocationForPage, syncCaseDetailLocation, clearCaseDetailLocation } from './lib/appRoutes';
import { isFirmManagerRole } from './lib/roleAccess';
import { useBillingAdmin } from './hooks/useBillingAdmin';

const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const AuthPages = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.AuthPages })));
const ArchivePage = lazy(() => import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage })));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })));
const DashboardPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.DashboardPage })));
const ClientsPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.ClientsPage })));
const CasesPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.CasesPage })));
const SessionsPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.SessionsPage })));
const DocumentsPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.DocumentsPage })));
const LawyersPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.LawyersPage })));
const ReportsPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.ReportsPage })));
const SubscriptionPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.SubscriptionPage })));
const ProfilePage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('./pages/WorkspacePages').then((m) => ({ default: m.SettingsPage })));
const ExecutionRequestsPage = lazy(() => import('./pages/ExecutionRequestsPage').then((m) => ({ default: m.ExecutionRequestsPage })));
const AdminSubscriptionPage = lazy(() => import('./pages/AdminSubscriptionPage').then((m) => ({ default: m.AdminSubscriptionPage })));
const CaseDetailPage = lazy(() => import('./pages/CaseDetailPage').then((m) => ({ default: m.CaseDetailPage })));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })));
const OfficeManagerPage = lazy(() => import('./pages/OfficeManagerPage').then((m) => ({ default: m.OfficeManagerPage })));

const initialClientForm: Omit<Client, 'id' | 'casesCount' | 'createdAt'> = {
  name: '', phone: '', email: '', address: '', type: 'فرد'
};

const initialCaseForm: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted'> = {
  title: '', clientId: '', category: 'تجاري', case_type: 'تجارية', case_stage: 'استئناف',
  court_case_number: '', total_amount: 0, paid_amount: 0, remaining_amount: 0,
  status: 'active', court: '', caseNo: '', lawyerId: '', description: '', notes: ''
};

const initialSessionForm: Omit<SessionItem, 'id' | 'caseTitle'> = {
  caseId: '', court: '', date: '', time: '', status: 'مجدولة', type: '', notes: '',
  judgeName: '', nextSessionDate: '', sessionOutcome: ''
};

const initialEmployeeForm: Omit<Employee, 'id' | 'created_at'> = {
  full_name: '', email: '', phone: '', role: 'lawyer', status: 'active'
};

const PUBLIC_PAGES: PageId[] = [
  'landing',
  'login',
  'register',
  'register-office',
  'register-lawyer',
  'invite',
  'forgot',
  'accept-invite'
];

export default function App() {
  const auth = useAuth();
  const isAuth = auth.isAuthenticated;
  const syncState = useOfflineSync(isAuth);

  // currentPage must be declared before queries so page-scoped `enabled` flags work
  const [currentPage, setCurrentPage] = useState<PageId>(() => resolvePageFromLocation().page ?? 'landing');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() => resolvePageFromLocation().caseId ?? null);

  const navigateToPage = useCallback((page: PageId) => {
    setCurrentPage(page);
    if (page !== 'case-detail') {
      setSelectedCaseId(null);
      clearCaseDetailLocation();
    }
    syncLocationForPage(page);
  }, []);

  // Dev-only connection test — runs once after auth is ready
  useEffect(() => {
    if (!import.meta.env.DEV || !isAuth) return;
    const timer = window.setTimeout(() => {
      void testSupabaseConnection().then((result) => {
        if (!result.syncRpcReady && result.authenticated) {
          console.info('[TEST] المزامنة غير جاهزة — تأكد من تشغيل migrations 021 و 025 في Supabase');
        }
      });
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [isAuth]);

  // Page-scoped data — avoid loading heavy lists on subscription/profile pages
  const needsClients =
    isAuth &&
    (currentPage === 'clients' ||
      currentPage === 'dashboard' ||
      currentPage === 'execution' ||
      currentPage === 'cases');
  const needsCases =
    isAuth &&
    (currentPage === 'dashboard' ||
      currentPage === 'execution' ||
      currentPage === 'cases' ||
      currentPage === 'archive' ||
      currentPage === 'reports' ||
      currentPage === 'sessions' ||
      currentPage === 'office-manager');

  const { data: clients = [], isLoading: clientsLoading, isError: clientsError, error: clientsQueryError } =
    useClients(needsClients);
  const { data: cases = [], isLoading: casesLoading, isError: casesError, error: casesQueryError } =
    useCases(needsCases);

  const needsHeaderAlerts = isAuth && !PUBLIC_PAGES.includes(currentPage);
  const needsEmployees = isAuth && (currentPage === 'employees' || currentPage === 'settings' || currentPage === 'dashboard');
  const needsSessions  = isAuth && (currentPage === 'sessions'  || currentPage === 'dashboard' || currentPage === 'cases' || currentPage === 'case-detail');
  const needsDocuments = isAuth && (currentPage === 'documents' || currentPage === 'case-detail');
  const needsLawyers   = isAuth && (currentPage === 'lawyers'   || currentPage === 'cases' || currentPage === 'dashboard' || currentPage === 'office-manager');
  const needsArchive   = isAuth && (currentPage === 'archive'   || currentPage === 'reports');
  const needsInvites   = isAuth && currentPage === 'employees';

  const { data: employees = [], isLoading: employeesLoading, isError: employeesError } = useEmployees(needsEmployees);
  const { data: sessions = [], isLoading: sessionsLoading, isError: sessionsError } = useSessions(needsSessions);
  const { data: documents = [], isLoading: documentsLoading, isError: documentsError } = useDocuments(needsDocuments);
  const { data: lawyers = [], isLoading: lawyersLoading, isError: lawyersError } = useLawyers(needsLawyers);
  const { data: archivedCases = [] } = useArchivedCases(needsArchive);
  const { data: invitations = [] } = useInvitations(needsInvites);
  const { data: office } = useOffice(isAuth);
  const { data: notifications = [] } = useNotifications(needsHeaderAlerts);
  const { data: upcomingSessions = [], isLoading: upcomingSessionsLoading } = useUpcomingSessions(needsHeaderAlerts);
  const canShowFirmCode = Boolean(auth.user && canManageOffice(auth.user.role));
  const { data: firmProfile } = useFirmProfile(isAuth && canShowFirmCode);
  const isSuperAdmin = Boolean(auth.user && isSuperAdminRole(auth.user.role));
  const needsBillingAdminCheck = isAuth && (currentPage === 'admin-billing' || isSuperAdmin);
  const { data: isBillingAdminDb = false, isLoading: isBillingAdminLoading } = useBillingAdmin(needsBillingAdminCheck);
  const isBillingAdmin = isBillingAdminDb || Boolean(auth.user && isSuperAdminRole(auth.user.role));
  const firmCode = office?.firmCode ?? firmProfile?.officeCode;
  const firmName = office?.name ?? firmProfile?.officeName ?? auth.user?.company;

  const whatsappReportsEnabled = office?.whatsappReportsEnabled !== false;
  const smsReportsEnabled = Boolean(office?.smsReportsEnabled);
  const canSendClientReport = whatsappReportsEnabled || smsReportsEnabled;
  const remindersEnabled = office?.remindersEnabled !== false;

  const clientMutations = useClientMutations();
  const caseMutations = useCaseMutations();
  const sessionMutations = useSessionMutations();
  const documentMutations = useDocumentMutations();
  const employeeMutations = useEmployeeMutations();
  const officeMutations = useOfficeMutations();
  const notificationMutations = useNotificationMutations();
  const [activeChartTab, setActiveChartTab] = useState<'cases' | 'revenue'>('cases');
  const [hoveredDataPoint, setHoveredDataPoint] = useState<ChartPoint | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [categoryFilter, setCategoryFilter] = useState('الكل');
  const [showClientModal, , setShowClientModal] = useToggle(false);
  const [showCaseModal, , setShowCaseModal] = useToggle(false);
  const [showSessionModal, , setShowSessionModal] = useToggle(false);
  const [showDocumentModal, , setShowDocumentModal] = useToggle(false);
  const [showEmployeeModal, , setShowEmployeeModal] = useToggle(false);
  const [showNotificationDropdown, , setShowNotificationDropdown] = useToggle(false);
  const [showUserDropdown, , setShowUserDropdown] = useToggle(false);
  const [isMobileMenuOpen, , setIsMobileMenuOpen] = useToggle(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingCase, setEditingCase] = useState<CaseRecord | null>(null);
  const [archivingCase, setArchivingCase] = useState<CaseRecord | null>(null);
  const [archiveNotes, setArchiveNotes] = useState('');
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionItem | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [newClient, setNewClient] = useState(initialClientForm);
  const [newCase, setNewCase] = useState(initialCaseForm);
  const [newSession, setNewSession] = useState(initialSessionForm);
  const [newDocument, setNewDocument] = useState({ title: '', caseId: '', category: 'مستند قانوني' });
  const [newEmployee, setNewEmployee] = useState(initialEmployeeForm);
  const [alertMsg, setAlertMsg] = useState<AlertState | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [reportClient, setReportClient] = useState<Client | null>(null);
  const [pendingInvitationShare, setPendingInvitationShare] = useState<Invitation | null>(null);
  const [paymentReminderCase, setPaymentReminderCase] = useState<CaseRecord | null>(null);
  const alertTimeout = useRef<number | null>(null);

  const queryClient = useQueryClient();
  const refreshNotifications = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  }, [queryClient]);

  useRealtimeNotifications(refreshNotifications);

  useEffect(() => {
    const resolved = resolvePageFromLocation();
    if (resolved.page) setCurrentPage(resolved.page);

    const params = new URLSearchParams(window.location.search);
    const page = params.get('page') as PageId | null;
    if (page === 'invite') setCurrentPage('invite');
    if (page === 'accept-invite') setCurrentPage('accept-invite');
    if (window.location.pathname === '/login') setCurrentPage('login');
    if (window.location.pathname === '/register-office') setCurrentPage('register-office');
    if (window.location.pathname === '/register-lawyer') setCurrentPage('register-lawyer');
    if (window.location.pathname.startsWith('/invite/')) setCurrentPage('invite');

    const onPopState = () => {
      const next = resolvePageFromLocation();
      if (next.page) setCurrentPage(next.page);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Redirect authenticated users away from all public pages (including
  // 'landing' which is the default after a hard refresh).
  // We wait for isLoading=false so we never redirect based on a transient
  // null user that arrives before the real session resolves.
  useEffect(() => {
    if (auth.isLoading) return;
    if (auth.isAuthenticated && PUBLIC_PAGES.includes(currentPage)) {
      setCurrentPage('dashboard');
      return;
    }
    if (!auth.isAuthenticated && !PUBLIC_PAGES.includes(currentPage)) {
      setCurrentPage('login');
    }
  }, [auth.isLoading, auth.isAuthenticated, currentPage]);

  useEffect(() => () => {
    if (alertTimeout.current) window.clearTimeout(alertTimeout.current);
  }, []);

  const showAlert = useCallback((text: string, type: AlertState['type'] = 'success') => {
    setAlertMsg({ text, type });
    if (alertTimeout.current) window.clearTimeout(alertTimeout.current);
    alertTimeout.current = window.setTimeout(() => setAlertMsg(null), 4000);
  }, []);

  useNotificationPermission(needsHeaderAlerts);
  useSessionReminders(upcomingSessions, needsHeaderAlerts, showAlert);

  const user = auth.user;

  const navigateToCaseDetail = useCallback((caseId: string) => {
    if (!user || !isFirmManagerRole(user.role)) {
      showAlert('عرض 360° متاح لمدير المكتب فقط.', 'error');
      return;
    }
    setSelectedCaseId(caseId);
    setCurrentPage('case-detail');
    syncCaseDetailLocation(caseId);
  }, [user, showAlert]);
  const checkAccess = useCallback((allowedRoles: UserRole[]) =>
    user !== null && checkRoleAccess(user.role, allowedRoles), [user]);

  // For lawyers: find their own lawyers.id by matching email so we can pre-fill case forms
  const currentUserLawyerId = useMemo(() => {
    if (!user || user.role !== 'lawyer') return '';
    return lawyers.find((l) => l.email === user.email)?.id ?? '';
  }, [user, lawyers]);

  useEffect(() => {
    if (!user) return;
    if (currentPage === 'admin-billing' && !isBillingAdminAccess(user.role, isBillingAdminDb) && !isBillingAdminLoading) {
      setCurrentPage('dashboard');
      showAlert('صفحة قبول الاشتراكات متاحة لسوبر أدمن المنصة فقط.', 'error');
    }
  }, [currentPage, isBillingAdminDb, isBillingAdminLoading, showAlert, user]);

  useEffect(() => {
    if (!user) return;
    if ((currentPage === 'employees' || currentPage === 'settings' || currentPage === 'reports') && !canManageOffice(user.role)) {
      setCurrentPage('dashboard');
      showAlert('هذه الصفحة متاحة لمدير المكتب فقط.', 'error');
    }
  }, [currentPage, showAlert, user]);

  useEffect(() => {
    if (!user) return;
    if (currentPage === 'case-detail' && !isFirmManagerRole(user.role)) {
      setCurrentPage('cases');
      setSelectedCaseId(null);
      clearCaseDetailLocation();
      showAlert('عرض 360° متاح لمدير المكتب فقط.', 'error');
    }
  }, [currentPage, showAlert, user]);

  useEffect(() => {
    if (!user) return;
    if (currentPage === 'office-manager' && !isFirmManagerRole(user.role)) {
      setCurrentPage('dashboard');
      showAlert('لوحة مدير المكتب متاحة لمدير المكتب فقط.', 'error');
    }
  }, [currentPage, showAlert, user]);

  const handleLogout = useCallback(async () => {
    await auth.logout();
    setCurrentPage('landing');
    showAlert('تم تسجيل الخروج بأمان.', 'info');
  }, [auth, showAlert]);

  const saveClient = async () => {
    if (!user || !canManageClients(user.role)) { showAlert('ليس لديك صلاحية إدارة العملاء.', 'error'); return; }
    if (!newClient.name.trim()) { showAlert('اسم الموكل مطلوب.', 'error'); return; }
    if (!isValidYemeniPhone(newClient.phone)) { showAlert('رقم الهاتف اليمني غير صالح.', 'error'); return; }
    try {
      if (editingClient) {
        await clientMutations.updateClient.mutateAsync({ ...editingClient, ...newClient });
        showAlert('تم تحديث العميل بنجاح.', 'success');
      } else {
        await clientMutations.addClient.mutateAsync(newClient);
        showAlert('تم إضافة العميل الجديد.', 'success');
      }
      setShowClientModal(false);
      setEditingClient(null);
      setNewClient(initialClientForm);
    } catch (err) {
      showAlert(toArabicQueryError(err, 'حفظ بيانات العميل'), 'error');
    }
  };

  const deleteClient = async (id: string) => {
    if (!checkAccess(['super_admin', 'admin', 'firm_manager'])) {
      showAlert('ليس لديك صلاحية حذف العملاء.', 'error'); return;
    }
    if (cases.some((c) => c.clientId === id)) {
      showAlert('لا يمكن حذف العميل لأنه مرتبط بقضية حالية.', 'error'); return;
    }
    if (!window.confirm('حذف هذا العميل؟')) return;
    try {
      await clientMutations.deleteClient.mutateAsync(id);
      showAlert('تم حذف العميل بنجاح.', 'info');
    } catch (err) {
      showAlert(toArabicQueryError(err, 'حذف العميل'), 'error');
    }
  };

  const saveCase = async () => {
    if (!user || !canManageCases(user.role)) { showAlert('ليس لديك صلاحية إدارة القضايا.', 'error'); return; }
    if (!newCase.title.trim() || !newCase.clientId || !newCase.caseNo.trim() || !newCase.court.trim()) {
      showAlert('يرجى تعبئة كافة حقول القضية.', 'error'); return;
    }
    const payload = { ...newCase, court_case_number: newCase.caseNo };
    try {
      if (editingCase) {
        await caseMutations.updateCase.mutateAsync({ ...editingCase, ...payload });
        showAlert('تم تحديث معلومات القضية.', 'success');
      } else {
        await caseMutations.addCase.mutateAsync(payload);
        showAlert('تم فتح ملف القضية بنجاح.', 'success');
      }
      setShowCaseModal(false);
      setEditingCase(null);
      setNewCase(initialCaseForm);
    } catch (err) {
      showAlert(formatCaseSaveError(err), 'error');
    }
  };

  const deleteCase = async (id: string) => {
    if (!checkAccess(['super_admin', 'admin', 'firm_manager'])) {
      showAlert('ليس لديك صلاحية حذف القضايا.', 'error'); return;
    }
    if (!window.confirm('حذف هذه القضية نهائياً؟')) return;
    try {
      await caseMutations.deleteCase.mutateAsync(id);
      showAlert('تم حذف القضية.', 'info');
    } catch (err) {
      showAlert(toArabicQueryError(err, 'حذف القضية'), 'error');
    }
  };

  const openArchiveCase = (caseRecord: CaseRecord) => {
    setArchivingCase(caseRecord);
    setArchiveNotes(caseRecord.notes ?? '');
    setShowArchiveModal(true);
  };

  const confirmArchiveCase = async () => {
    if (!archivingCase) return;
    try {
      await caseMutations.archiveCase.mutateAsync({ id: archivingCase.id, notes: archiveNotes });
      showAlert('تمت أرشفة القضية ونقلها إلى الأرشيف.', 'success');
      setShowArchiveModal(false);
      setArchivingCase(null);
      setArchiveNotes('');
    } catch (err) {
      showAlert(toArabicQueryError(err, 'أرشفة القضية'), 'error');
    }
  };

  const saveSession = async () => {
    if (!newSession.caseId || !newSession.date || !newSession.time || !newSession.court.trim()) {
      showAlert('يرجى إكمال تفاصيل الجلسة.', 'error'); return;
    }
    try {
      if (editingSession) {
        await sessionMutations.updateSession.mutateAsync({ ...editingSession, ...newSession });
        showAlert('تم تحديث الجلسة.', 'success');
      } else {
        await sessionMutations.createSession.mutateAsync(newSession);
        const relatedCase = cases.find((c) => c.id === newSession.caseId);
        if (remindersEnabled) {
          await notificationMutations.createNotification.mutateAsync({
            title: 'موعد جلسة جديدة',
            message: `مجدولة لقضية "${relatedCase?.title ?? ''}" بتاريخ ${newSession.date}`,
            type: 'session'
          });
          showAlert('تم حفظ الجلسة وإرسال التنبيه.', 'success');
        } else {
          showAlert('تم حفظ الجلسة بنجاح.', 'success');
        }
      }
      setShowSessionModal(false);
      setEditingSession(null);
      setNewSession(initialSessionForm);
    } catch (err) {
      showAlert(toArabicQueryError(err, 'حفظ الجلسة'), 'error');
    }
  };

  const deleteSession = async (id: string) => {
    if (!window.confirm('إلغاء/حذف هذه الجلسة؟')) return;
    try {
      await sessionMutations.deleteSession.mutateAsync(id);
      showAlert('تم إلغاء الجلسة.', 'info');
    } catch (err) {
      showAlert(toArabicQueryError(err, 'حذف الجلسة'), 'error');
    }
  };

  const uploadDocument = async () => {
    if (!documentFile || !newDocument.caseId) {
      showAlert('يرجى اختيار ملف وقضية.', 'error'); return;
    }
    try {
      await documentMutations.uploadFile.mutateAsync({
        file: documentFile,
        caseId: newDocument.caseId,
        title: newDocument.title.trim() || undefined,
        category: newDocument.category
      });
      void queryClient.invalidateQueries({ queryKey: ['case-timeline', newDocument.caseId] });
      setShowDocumentModal(false);
      setNewDocument({ title: '', caseId: '', category: 'مستند قانوني' });
      setDocumentFile(null);
      showAlert('تم رفع المستند بنجاح.', 'success');
    } catch (err) {
      showAlert(toArabicQueryError(err, 'رفع المستند'), 'error');
    }
  };

  const saveEmployee = async () => {
    if (!user || !canManageOffice(user.role)) { showAlert('ليس لديك صلاحية إدارة الفريق.', 'error'); return; }
    if (!newEmployee.full_name.trim() || !newEmployee.email.trim()) {
      showAlert('اسم الموظف والبريد الإلكتروني مطلوبان.', 'error'); return;
    }
    if (!isValidEmail(newEmployee.email.trim())) {
      showAlert('البريد الإلكتروني غير صالح. استخدم صيغة مثل name@example.com (أحرف إنجليزية فقط).', 'error');
      return;
    }
    if (newEmployee.phone.trim() && !isValidYemeniPhone(newEmployee.phone)) {
      showAlert('رقم الهاتف غير صالح. استخدم رقم يمني مثل 770000000.', 'error');
      return;
    }
    try {
      if (editingEmployee) {
        await employeeMutations.updateEmployee.mutateAsync({ ...editingEmployee, ...newEmployee });
        showAlert('تم تحديث صلاحيات عضو الفريق.', 'success');
      } else {
        const invitation = await employeeMutations.inviteEmployee.mutateAsync({
          email: newEmployee.email.trim(),
          role: newEmployee.role === 'assistant' ? 'assistant' : 'lawyer',
          fullName: newEmployee.full_name.trim(),
          phone: newEmployee.phone.trim() || undefined
        });
        if (invitation.inviteUrl) {
          setPendingInvitationShare(invitation);
        } else {
          showAlert('تم إنشاء الدعوة. انسخ الرابط من قائمة الدعوات المعلقة.', 'success');
        }
      }
      setShowEmployeeModal(false);
      setEditingEmployee(null);
      setNewEmployee(initialEmployeeForm);
    } catch (err) {
      showAlert(toArabicQueryError(err, 'حفظ عضو الفريق'), 'error');
    }
  };

  const filteredCases = useMemo(() => cases.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    const matchSearch = item.title.toLowerCase().includes(q) || item.clientName.toLowerCase().includes(q) || item.caseNo.includes(q);
    const matchStatus = statusFilter === 'الكل' || item.status === statusFilter;
    const matchCategory = categoryFilter === 'الكل' || item.category === categoryFilter;
    return matchSearch && matchStatus && matchCategory;
  }), [cases, searchQuery, statusFilter, categoryFilter]);

  const filteredClients = useMemo(() => clients.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q);
  }), [clients, searchQuery]);

  const stats = useMemo(() => ({
    totalClients: clients.length,
    totalCases: cases.length,
    activeCases: cases.filter((c) => c.status === 'active').length,
    upcomingSessions: sessions.filter((s) => s.status === 'مجدولة').length,
    totalDocuments: documents.length,
    lawyersCount: lawyers.length
  }), [clients.length, cases, sessions, documents.length, lawyers.length]);

  const monthlyData = useMemo(() => buildMonthlyChartData(cases), [cases]);
  const dashboardPerformance = useMemo(() => buildPerformanceMetrics(cases, sessions), [cases, sessions]);
  const dashboardFinancials = useMemo(() => buildFinancialSummary(cases), [cases]);
  const dashboardStatHints = useMemo(
    () => buildStatHints(cases, clients, sessions, documents),
    [cases, clients, sessions, documents]
  );

  const pageLoading = useMemo(() => {
    if (!isAuth) return false;
    switch (currentPage) {
      case 'dashboard':
        return (
          clientsLoading ||
          casesLoading ||
          employeesLoading ||
          sessionsLoading ||
          documentsLoading ||
          lawyersLoading
        );
      case 'clients':
        return clientsLoading;
      case 'execution':
        return clientsLoading || casesLoading;
      case 'cases':
        return casesLoading;
      case 'archive':
        return casesLoading;
      case 'employees':
        return employeesLoading;
      case 'sessions':
        return sessionsLoading;
      case 'documents':
        return documentsLoading;
      case 'lawyers':
        return lawyersLoading;
      case 'reports':
        return casesLoading;
      case 'office-manager':
        return casesLoading || lawyersLoading;
      default:
        return false;
    }
  }, [
    isAuth,
    currentPage,
    clientsLoading,
    casesLoading,
    employeesLoading,
    sessionsLoading,
    documentsLoading,
    lawyersLoading
  ]);

  const hasQueryError =
    isAuth &&
    (clientsError || casesError || employeesError || sessionsError || documentsError || lawyersError);
  const showAppChrome = Boolean(user) && !PUBLIC_PAGES.includes(currentPage);

  const refetchWorkspaceData = () => {
    void queryClient.invalidateQueries({ queryKey: ['clients'] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.employees });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    void queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lawyers });
  };

  // Show a full-screen spinner while Supabase resolves the stored session.
  // Without this guard the landing page flashes before the redirect kicks in.
  if (auth.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center" dir="rtl">
        <div className="flex flex-col items-center gap-4 text-slate-400">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <span className="text-sm font-bold">جاري التحقق من الجلسة…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      {alertMsg && <AlertBanner alert={alertMsg} />}

      {showAppChrome && user && (
        <>
          <HeaderBar
            user={user}
            currentPage={currentPage}
            role={user.role}
            onChangePage={navigateToPage}
            notificationCount={notifications.filter((n) => !n.read).length + upcomingSessions.length}
            notifications={notifications}
            upcomingSessions={upcomingSessions}
            sessionsLoading={upcomingSessionsLoading}
            showNotificationDropdown={showNotificationDropdown}
            showUserDropdown={showUserDropdown}
            isMobileMenuOpen={isMobileMenuOpen}
            setShowNotificationDropdown={setShowNotificationDropdown}
            setShowUserDropdown={setShowUserDropdown}
            setIsMobileMenuOpen={setIsMobileMenuOpen}
            markAllNotificationsRead={() => void notificationMutations.markAllNotificationsRead.mutateAsync()}
            markNotificationRead={(id) => void notificationMutations.markNotificationRead.mutateAsync(id)}
            handleLogout={() => void handleLogout()}
            firmCode={canShowFirmCode ? firmCode : undefined}
            firmName={firmName}
            onFirmCodeCopied={(msg) => showAlert(msg, 'success')}
            isSuperAdmin={isSuperAdmin}
            isBillingAdmin={isBillingAdmin}
          />
          {/* SyncStatusBar is rendered as floating pill at the bottom — see below */}
        </>
      )}

      {hasQueryError ? (
        <QueryErrorBanner
          message={toArabicQueryError(clientsQueryError ?? casesQueryError)}
          onRetry={refetchWorkspaceData}
        />
      ) : null}

      <SubscriptionGuard
        isAuthenticated={isAuth}
        currentPage={currentPage}
        onNavigate={navigateToPage}
        onLogout={() => void handleLogout()}
      >
      <main className="pb-16">
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
          <DashboardPage user={user} sessions={sessions} documents={documents}
            activeChartTab={activeChartTab} hoveredDataPoint={hoveredDataPoint}
            setActiveChartTab={setActiveChartTab} setHoveredDataPoint={setHoveredDataPoint}
            stats={stats} monthlyData={monthlyData} performance={dashboardPerformance}
            financials={dashboardFinancials} statHints={dashboardStatHints}
            setCurrentPage={navigateToPage}
            setShowClientModal={setShowClientModal}
            setShowCaseModal={(v) => { if (v) { setEditingCase(null); setNewCase({ ...initialCaseForm, lawyerId: currentUserLawyerId }); } setShowCaseModal(v); }}
            setShowSessionModal={setShowSessionModal}
            office={office}
            remindersEnabled={remindersEnabled}
            onFirmCodeCopied={(msg) => showAlert(msg, 'success')} />
        )}

        {currentPage === 'clients' && user && !pageLoading && (
          <ClientsPage clients={filteredClients} searchQuery={searchQuery} onSearch={setSearchQuery}
            onCreateClient={() => { setEditingClient(null); setNewClient(initialClientForm); setShowClientModal(true); }}
            onEditClient={(c) => { setEditingClient(c); setNewClient({ name: c.name, phone: c.phone, email: c.email, address: c.address, type: c.type }); setShowClientModal(true); }}
            onDeleteClient={(id) => void deleteClient(id)}
            canSendReport={canSendClientReport}
            onSendReport={(c) => setReportClient(c)} />
        )}

        {currentPage === 'execution' && user && !pageLoading && (
          <ExecutionRequestsPage
            clients={clients}
            cases={cases}
            onNotify={(message, type = 'info') => showAlert(message, type)}
          />
        )}

        {currentPage === 'cases' && user && !pageLoading && (
          <CasesPage cases={filteredCases} searchQuery={searchQuery} statusFilter={statusFilter}
            categoryFilter={categoryFilter} onSearch={setSearchQuery}
            onStatusFilterChange={setStatusFilter} onCategoryFilterChange={setCategoryFilter}
            onCreateCase={() => { setEditingCase(null); setNewCase({ ...initialCaseForm, lawyerId: currentUserLawyerId }); setShowCaseModal(true); }}
            onEditCase={(cr) => { setEditingCase(cr); setNewCase({ title: cr.title, clientId: cr.clientId, category: cr.category, case_type: cr.case_type, case_stage: cr.case_stage, court_case_number: cr.court_case_number, total_amount: cr.total_amount, paid_amount: cr.paid_amount, remaining_amount: cr.remaining_amount, status: cr.status, court: cr.court, caseNo: cr.caseNo, lawyerId: cr.lawyerId, description: cr.description, notes: cr.notes ?? '' }); setShowCaseModal(true); }}
            onViewCase={(cr) => navigateToCaseDetail(cr.id)}
            onArchiveCase={openArchiveCase}
            onDeleteCase={(id) => void deleteCase(id)}
            canSendPaymentReminder={whatsappReportsEnabled}
            onSendPaymentReminder={(cr) => setPaymentReminderCase(cr)}
            canViewCase360={Boolean(user && isFirmManagerRole(user.role))} />
        )}

        {currentPage === 'case-detail' && user && selectedCaseId && isFirmManagerRole(user.role) && (
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
                caseId: s.caseId, court: s.court, date: s.date, time: s.time, status: s.status,
                type: s.type, notes: s.notes, judgeName: s.judgeName ?? '', nextSessionDate: s.nextSessionDate ?? '',
                sessionOutcome: s.sessionOutcome ?? ''
              });
              setShowSessionModal(true);
            }}
            onNotify={(message, type = 'info') => showAlert(message, type)}
          />
        )}

        {currentPage === 'archive' && user && !pageLoading && (
          <ArchivePage cases={archivedCases}
            onRestore={(id) => void caseMutations.restoreCase.mutateAsync(id).then(() => showAlert('تمت استعادة القضية.', 'success'))}
            onPermanentArchive={(id) => void deleteCase(id)} />
        )}

        {currentPage === 'employees' && user && !pageLoading && (
          <EmployeesPage employees={employees} invitations={invitations}
            onInvite={() => { setEditingEmployee(null); setNewEmployee(initialEmployeeForm); setShowEmployeeModal(true); }}
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
            onEdit={(employee) => { setEditingEmployee(employee); setNewEmployee({ full_name: employee.full_name, email: employee.email, phone: employee.phone, role: employee.role, status: employee.status, profile_image: employee.profile_image }); setShowEmployeeModal(true); }}
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
            onCopyInvitation={(url) => void navigator.clipboard.writeText(url).then(() => showAlert('تم نسخ رابط الدعوة.', 'success')).catch(() => showAlert('تعذر نسخ الرابط.', 'error'))}
            firmCode={firmCode}
            firmName={firmName}
            onFirmCodeCopied={(msg) => showAlert(msg, 'success')}
          />
        )}

        {currentPage === 'sessions' && user && !pageLoading && (
          <SessionsPage sessions={sessions}
            onCreateSession={() => { setEditingSession(null); setNewSession(initialSessionForm); setShowSessionModal(true); }}
            onEditSession={(s) => { setEditingSession(s); setNewSession({ caseId: s.caseId, court: s.court, date: s.date, time: s.time, status: s.status, type: s.type, notes: s.notes, judgeName: s.judgeName ?? '', nextSessionDate: s.nextSessionDate ?? '', sessionOutcome: s.sessionOutcome ?? '' }); setShowSessionModal(true); }}
            onDeleteSession={(id) => void deleteSession(id)} />
        )}

        {currentPage === 'documents' && user && !pageLoading && (
          <DocumentsPage
            documents={documents}
            onCreateDocument={() => setShowDocumentModal(true)}
            onGetUrl={(docId) => getDocumentDownloadUrl(docId)}
          />
        )}

        {currentPage === 'lawyers' && user && !pageLoading && <LawyersPage lawyers={lawyers} />}
        {currentPage === 'reports' && user && (
          <ReportsPage role={user.role} performance={dashboardPerformance} financials={dashboardFinancials} cases={cases} />
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
            onSaveOffice={(payload) => void officeMutations.updateOffice.mutateAsync(payload).then(() => showAlert('تم تحديث بيانات المكتب.', 'success')).catch((err) => showAlert(toArabicQueryError(err, 'تحديث بيانات المكتب'), 'error'))}
            onFirmCodeCopied={(msg) => showAlert(msg, 'success')}
            onOpenAuditLogs={() => navigateToPage('audit-logs')}
          />
        )}
        {currentPage === 'audit-logs' && user && canManageOffice(user.role) && (
          <AuditLogsPage />
        )}
        {currentPage === 'office-manager' && user && isFirmManagerRole(user.role) && !pageLoading && (
          <OfficeManagerPage
            role={user.role}
            cases={cases}
            lawyers={lawyers}
            onNotify={(message, type = 'info') => showAlert(message, type)}
          />
        )}
      </main>
      </SubscriptionGuard>

      <ClientModal open={showClientModal} client={editingClient} formState={newClient}
        onChange={setNewClient} onSave={() => void saveClient()} onClose={() => setShowClientModal(false)} />
      <CaseModal open={showCaseModal} caseRecord={editingCase} formState={newCase} clients={clients}
        lawyers={lawyers} onChange={setNewCase} onSave={() => void saveCase()} onClose={() => setShowCaseModal(false)} />
      <SessionModal open={showSessionModal} session={editingSession} formState={newSession} cases={cases}
        onChange={setNewSession} onSave={() => void saveSession()} onClose={() => setShowSessionModal(false)} />
      <DocumentModal open={showDocumentModal} formState={newDocument} cases={cases}
        onChange={setNewDocument} onSave={() => void uploadDocument()} onClose={() => setShowDocumentModal(false)}
        onFileSelect={setDocumentFile} selectedFile={documentFile} />
      <EmployeeModal open={showEmployeeModal} employee={editingEmployee} formState={newEmployee}
        onChange={setNewEmployee} onSave={() => void saveEmployee()} onClose={() => setShowEmployeeModal(false)} />
      <ArchiveCaseModal
        open={showArchiveModal}
        caseRecord={archivingCase}
        notes={archiveNotes}
        onNotesChange={setArchiveNotes}
        onConfirm={() => void confirmArchiveCase()}
        onClose={() => { setShowArchiveModal(false); setArchivingCase(null); setArchiveNotes(''); }}
      />
      <ClientReportModal
        client={reportClient}
        open={Boolean(reportClient)}
        whatsappEnabled={whatsappReportsEnabled}
        smsEnabled={smsReportsEnabled}
        onClose={() => setReportClient(null)}
        onSent={(message) => showAlert(message, message.includes('فشل') || message.includes('لا يوجد') ? 'error' : 'success')}
      />
      <InvitationLinkModal
        open={Boolean(pendingInvitationShare)}
        invitation={pendingInvitationShare}
        firmName={firmName}
        onClose={() => setPendingInvitationShare(null)}
        onCopied={(message) => showAlert(message, 'success')}
      />
      <PaymentReminderModal
        open={Boolean(paymentReminderCase)}
        caseRecord={paymentReminderCase}
        client={paymentReminderCase ? (clients.find((c) => c.id === paymentReminderCase.clientId) ?? null) : null}
        officeName={firmName ?? 'المكتب القانوني'}
        whatsappEnabled={whatsappReportsEnabled}
        smsEnabled={smsReportsEnabled}
        onClose={() => setPaymentReminderCase(null)}
        onSent={(message, type = 'success') => showAlert(message, type)}
      />

      {/* Floating sync pill — only visible when there is a problem or activity */}
      {isAuth && (
        <SyncStatusBar {...syncState} onSyncNow={() => void syncState.syncNow()} />
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './contexts/AuthContext';
import { useOfflineSync } from './hooks/useOfflineSync';
import { HeaderBar } from './components/HeaderBar';
import { SyncStatusBar } from './components/SyncStatusBar';
import { AlertBanner } from './components/AlertBanner';
import { canManageOffice } from './lib/api';
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
import type { PageId } from './types/app';
import { testSupabaseConnection } from './lib/testSupabaseConnection';
import { SubscriptionGuard } from './components/SubscriptionGuard';
import { QueryErrorBanner, toArabicQueryError } from './components/QueryErrorBanner';
import { isBillingAdminAccess, isSuperAdminRole, resolvePageFromLocation, syncLocationForPage, syncCaseDetailLocation, clearCaseDetailLocation, stashCaseDetailTab } from './lib/appRoutes';
import type { CaseDetailTab } from './types/app';
import { useBillingAdmin } from './hooks/useBillingAdmin';
import { PUBLIC_PAGES } from './app/workspaceForms';
import { useMyPermissions } from './hooks/useMyPermissions';
import { canAccessCaseDetail, canAccessPage } from './lib/permissions';
import { useWorkspacePageFlags } from './hooks/useWorkspacePageFlags';
import { useWorkspaceDerivedData } from './hooks/useWorkspaceDerivedData';
import { useWorkspaceActions } from './hooks/useWorkspaceActions';
import { WorkspaceRoutes } from './components/app/WorkspaceRoutes';
import { WorkspaceModals } from './components/app/WorkspaceModals';

export default function App() {
  const auth = useAuth();
  const isAuth = auth.isAuthenticated;
  const syncState = useOfflineSync(isAuth);

  const [currentPage, setCurrentPage] = useState<PageId>(() => resolvePageFromLocation().page ?? 'landing');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() => resolvePageFromLocation().caseId ?? null);
  const [employeesSection, setEmployeesSection] = useState<'team' | 'manager'>(() =>
    resolvePageFromLocation().page === 'office-manager' ? 'manager' : 'team'
  );

  const navigateToPage = useCallback((page: PageId) => {
    setCurrentPage(page);
    if (page === 'employees') setEmployeesSection('team');
    if (page !== 'case-detail') {
      setSelectedCaseId(null);
      clearCaseDetailLocation();
    }
    syncLocationForPage(page);
  }, []);

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

  const user = auth.user;
  const { permissions: myPermissions, isLoading: permissionsLoading } = useMyPermissions(isAuth);
  const pageFlags = useWorkspacePageFlags(currentPage, isAuth, user?.role);

  const { data: clients = [], isLoading: clientsLoading, isError: clientsError, error: clientsQueryError } =
    useClients(pageFlags.needsClients);
  const { data: cases = [], isLoading: casesLoading, isError: casesError, error: casesQueryError } =
    useCases(pageFlags.needsCases);

  const { data: employees = [], isLoading: employeesLoading, isError: employeesError, error: employeesQueryError } = useEmployees(pageFlags.needsEmployees);
  const { data: sessions = [], isLoading: sessionsLoading, isError: sessionsError, error: sessionsQueryError } = useSessions(pageFlags.needsSessions);
  const { data: documents = [], isLoading: documentsLoading, isError: documentsError, error: documentsQueryError } = useDocuments(pageFlags.needsDocuments);
  const { data: lawyers = [], isLoading: lawyersLoading, isError: lawyersError, error: lawyersQueryError } = useLawyers(pageFlags.needsLawyers);
  const { data: archivedCases = [] } = useArchivedCases(pageFlags.needsArchive);
  const { data: invitations = [] } = useInvitations(pageFlags.needsInvites);
  const { data: office } = useOffice(isAuth);
  const { data: notifications = [] } = useNotifications(pageFlags.needsHeaderAlerts);
  const { data: upcomingSessions = [], isLoading: upcomingSessionsLoading } = useUpcomingSessions(pageFlags.needsHeaderAlerts);

  const canShowFirmCode = Boolean(user && canManageOffice(user.role));
  const { data: firmProfile } = useFirmProfile(isAuth && canShowFirmCode);
  const isSuperAdmin = Boolean(user && isSuperAdminRole(user.role));
  const needsBillingAdminCheck = isAuth && (currentPage === 'admin-billing' || isSuperAdmin);
  const { data: isBillingAdminDb = false, isLoading: isBillingAdminLoading } = useBillingAdmin(needsBillingAdminCheck);
  const isBillingAdmin = isBillingAdminDb || Boolean(user && isSuperAdminRole(user.role));
  const firmCode = office?.firmCode ?? firmProfile?.officeCode;
  const firmName = office?.name ?? firmProfile?.officeName ?? user?.company;

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

  const workspace = useWorkspaceActions({
    user,
    cases,
    remindersEnabled,
    clientMutations,
    caseMutations,
    sessionMutations,
    documentMutations,
    employeeMutations,
    notificationMutations
  });

  const queryClient = useQueryClient();
  const refreshNotifications = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  }, [queryClient]);

  useRealtimeNotifications(refreshNotifications, pageFlags.needsHeaderAlerts);

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

  useNotificationPermission(pageFlags.needsHeaderAlerts);
  useSessionReminders(upcomingSessions, pageFlags.needsHeaderAlerts, workspace.showAlert);

  const navigateToCaseDetail = useCallback((caseId: string, initialTab?: CaseDetailTab) => {
    if (!user || !canAccessCaseDetail(myPermissions, user.role)) {
      workspace.showAlert('ليس لديك صلاحية الوصول لبيانات القضية المالية.', 'error');
      return;
    }
    if (initialTab) stashCaseDetailTab(initialTab);
    setSelectedCaseId(caseId);
    setCurrentPage('case-detail');
    syncCaseDetailLocation(caseId);
  }, [myPermissions, user, workspace.showAlert]);

  const currentUserLawyerId = useMemo(() => {
    if (!user || user.role !== 'lawyer') return '';
    return lawyers.find((l) => l.email === user.email)?.id ?? '';
  }, [user, lawyers]);

  useEffect(() => {
    if (!user) return;
    if (currentPage === 'admin-billing' && !isBillingAdminAccess(user.role, isBillingAdminDb) && !isBillingAdminLoading) {
      setCurrentPage('dashboard');
      workspace.showAlert('صفحة قبول الاشتراكات متاحة لسوبر أدمن المنصة فقط.', 'error');
    }
  }, [currentPage, isBillingAdminDb, isBillingAdminLoading, workspace.showAlert, user]);

  useEffect(() => {
    if (!user || permissionsLoading) return;
    if (PUBLIC_PAGES.includes(currentPage)) return;
    if (currentPage === 'profile' || currentPage === 'dashboard') return;
    if (!canAccessPage(myPermissions, currentPage, user.role)) {
      setCurrentPage('dashboard');
      workspace.showAlert('ليس لديك صلاحية للوصول إلى هذه الصفحة.', 'error');
    }
  }, [currentPage, myPermissions, permissionsLoading, user, workspace]);

  useEffect(() => {
    if (!user || permissionsLoading) return;
    if (currentPage === 'case-detail' && !canAccessCaseDetail(myPermissions, user.role)) {
      setCurrentPage('cases');
      setSelectedCaseId(null);
      clearCaseDetailLocation();
      workspace.showAlert('ليس لديك صلاحية الوصول لبيانات القضية المالية.', 'error');
    }
  }, [currentPage, myPermissions, permissionsLoading, workspace.showAlert, user]);

  useEffect(() => {
    if (currentPage !== 'office-manager') return;
    setEmployeesSection('manager');
    setCurrentPage('employees');
    if (window.location.pathname === '/office-manager') {
      window.history.replaceState({ page: 'employees' }, '', '/');
    }
  }, [currentPage]);

  const handleLogout = useCallback(async () => {
    await auth.logout();
    setCurrentPage('landing');
    workspace.showAlert('تم تسجيل الخروج بأمان.', 'info');
  }, [auth, workspace.showAlert]);

  const derived = useWorkspaceDerivedData({
    isAuth,
    currentPage,
    user,
    clients,
    cases,
    sessions,
    documents,
    lawyers,
    searchQuery: workspace.searchQuery,
    statusFilter: workspace.statusFilter,
    categoryFilter: workspace.categoryFilter,
    clientsLoading,
    casesLoading,
    employeesLoading,
    sessionsLoading,
    documentsLoading,
    lawyersLoading
  });

  const hasQueryError =
    isAuth &&
    (clientsError || casesError || employeesError || sessionsError || documentsError || lawyersError);

  const firstQueryError =
    clientsQueryError ??
    casesQueryError ??
    employeesQueryError ??
    sessionsQueryError ??
    documentsQueryError ??
    lawyersQueryError;

  const showAppChrome = Boolean(user) && !PUBLIC_PAGES.includes(currentPage);

  const refetchWorkspaceData = () => {
    void queryClient.invalidateQueries({ queryKey: ['clients'] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.employees });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    void queryClient.invalidateQueries({ queryKey: queryKeys.documents });
    void queryClient.invalidateQueries({ queryKey: queryKeys.lawyers });
  };

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
      {workspace.alertMsg && <AlertBanner alert={workspace.alertMsg} />}

      {showAppChrome && user && (
        <HeaderBar
          user={user}
          currentPage={currentPage}
          role={user.role}
          permissions={myPermissions}
          onChangePage={navigateToPage}
          notificationCount={notifications.filter((n) => !n.read).length + upcomingSessions.length}
          notifications={notifications}
          upcomingSessions={upcomingSessions}
          sessionsLoading={upcomingSessionsLoading}
          showNotificationDropdown={workspace.showNotificationDropdown}
          showUserDropdown={workspace.showUserDropdown}
          isMobileMenuOpen={workspace.isMobileMenuOpen}
          setShowNotificationDropdown={workspace.setShowNotificationDropdown}
          setShowUserDropdown={workspace.setShowUserDropdown}
          setIsMobileMenuOpen={workspace.setIsMobileMenuOpen}
          markAllNotificationsRead={() => void notificationMutations.markAllNotificationsRead.mutateAsync()}
          markNotificationRead={(id) => void notificationMutations.markNotificationRead.mutateAsync(id)}
          handleLogout={() => void handleLogout()}
          firmCode={canShowFirmCode ? firmCode : undefined}
          firmName={firmName}
          onFirmCodeCopied={(msg) => workspace.showAlert(msg, 'success')}
          isSuperAdmin={isSuperAdmin}
          isBillingAdmin={isBillingAdmin}
        />
      )}

      {hasQueryError ? (
        <QueryErrorBanner
          message={toArabicQueryError(firstQueryError, 'تحميل بيانات المكتب')}
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
          <WorkspaceRoutes
            currentPage={currentPage}
            isAuth={isAuth}
            pageLoading={derived.pageLoading}
            user={user}
            selectedCaseId={selectedCaseId}
            employeesSection={employeesSection}
            clients={clients}
            cases={cases}
            filteredClients={derived.filteredClients}
            filteredCases={derived.filteredCases}
            sessions={sessions}
            documents={documents}
            lawyers={lawyers}
            employees={employees}
            invitations={invitations}
            archivedCases={archivedCases}
            office={office}
            firmCode={firmCode}
            firmName={firmName}
            whatsappReportsEnabled={whatsappReportsEnabled}
            smsReportsEnabled={smsReportsEnabled}
            canSendClientReport={canSendClientReport}
            remindersEnabled={remindersEnabled}
            isBillingAdmin={isBillingAdmin}
            isBillingAdminLoading={isBillingAdminLoading}
            currentUserLawyerId={currentUserLawyerId}
            stats={derived.stats}
            monthlyData={derived.monthlyData}
            dashboardPerformance={derived.dashboardPerformance}
            dashboardFinancials={derived.dashboardFinancials}
            dashboardStatHints={derived.dashboardStatHints}
            permissions={myPermissions}
            activeChartTab={workspace.activeChartTab}
            hoveredDataPoint={workspace.hoveredDataPoint}
            searchQuery={workspace.searchQuery}
            statusFilter={workspace.statusFilter}
            categoryFilter={workspace.categoryFilter}
            setActiveChartTab={workspace.setActiveChartTab}
            setHoveredDataPoint={workspace.setHoveredDataPoint}
            setSearchQuery={workspace.setSearchQuery}
            setStatusFilter={workspace.setStatusFilter}
            setCategoryFilter={workspace.setCategoryFilter}
            setShowClientModal={workspace.setShowClientModal}
            setShowCaseModal={workspace.setShowCaseModal}
            setShowSessionModal={workspace.setShowSessionModal}
            setShowDocumentModal={workspace.setShowDocumentModal}
            setShowEmployeeModal={workspace.setShowEmployeeModal}
            setEditingClient={workspace.setEditingClient}
            setEditingCase={workspace.setEditingCase}
            setEditingSession={workspace.setEditingSession}
            setEditingEmployee={workspace.setEditingEmployee}
            setNewClient={workspace.setNewClient}
            setNewCase={workspace.setNewCase}
            setNewSession={workspace.setNewSession}
            setNewEmployee={workspace.setNewEmployee}
            setReportClient={workspace.setReportClient}
            setPaymentReminderCase={workspace.setPaymentReminderCase}
            navigateToPage={navigateToPage}
            navigateToCaseDetail={navigateToCaseDetail}
            showAlert={workspace.showAlert}
            deleteClient={workspace.deleteClient}
            deleteCase={workspace.deleteCase}
            openArchiveCase={workspace.openArchiveCase}
            deleteSession={workspace.deleteSession}
            auth={auth}
            caseMutations={caseMutations}
            employeeMutations={employeeMutations}
            officeMutations={officeMutations}
          />
        </main>
      </SubscriptionGuard>

      <WorkspaceModals
        showClientModal={workspace.showClientModal}
        editingClient={workspace.editingClient}
        newClient={workspace.newClient}
        onClientChange={workspace.setNewClient}
        onSaveClient={() => void workspace.saveClient()}
        onCloseClient={() => workspace.setShowClientModal(false)}
        showCaseModal={workspace.showCaseModal}
        editingCase={workspace.editingCase}
        newCase={workspace.newCase}
        clients={clients}
        lawyers={lawyers}
        onCaseChange={workspace.setNewCase}
        onSaveCase={() => void workspace.saveCase()}
        onCloseCase={() => workspace.setShowCaseModal(false)}
        showSessionModal={workspace.showSessionModal}
        editingSession={workspace.editingSession}
        newSession={workspace.newSession}
        cases={cases}
        onSessionChange={workspace.setNewSession}
        onSaveSession={() => void workspace.saveSession()}
        onCloseSession={() => workspace.setShowSessionModal(false)}
        showDocumentModal={workspace.showDocumentModal}
        newDocument={workspace.newDocument}
        onDocumentChange={workspace.setNewDocument}
        onSaveDocument={() => void workspace.uploadDocument()}
        onCloseDocument={() => workspace.setShowDocumentModal(false)}
        documentFile={workspace.documentFile}
        onFileSelect={workspace.setDocumentFile}
        showEmployeeModal={workspace.showEmployeeModal}
        editingEmployee={workspace.editingEmployee}
        newEmployee={workspace.newEmployee}
        onEmployeeChange={workspace.setNewEmployee}
        onSaveEmployee={() => void workspace.saveEmployee()}
        onCloseEmployee={() => workspace.setShowEmployeeModal(false)}
        showArchiveModal={workspace.showArchiveModal}
        archivingCase={workspace.archivingCase}
        archiveNotes={workspace.archiveNotes}
        onArchiveNotesChange={workspace.setArchiveNotes}
        onConfirmArchive={() => void workspace.confirmArchiveCase()}
        onCloseArchive={() => {
          workspace.setShowArchiveModal(false);
          workspace.setArchivingCase(null);
          workspace.setArchiveNotes('');
        }}
        reportClient={workspace.reportClient}
        whatsappReportsEnabled={whatsappReportsEnabled}
        smsReportsEnabled={smsReportsEnabled}
        onCloseReport={() => workspace.setReportClient(null)}
        onReportSent={(message) =>
          workspace.showAlert(message, message.includes('فشل') || message.includes('لا يوجد') ? 'error' : 'success')
        }
        pendingInvitationShare={workspace.pendingInvitationShare}
        firmName={firmName}
        onCloseInvitation={() => workspace.setPendingInvitationShare(null)}
        onInvitationCopied={(message) => workspace.showAlert(message, 'success')}
        paymentReminderCase={workspace.paymentReminderCase}
        paymentReminderClient={
          workspace.paymentReminderCase
            ? (clients.find((c) => c.id === workspace.paymentReminderCase!.clientId) ?? null)
            : null
        }
        officeName={firmName ?? 'المكتب القانوني'}
        onClosePaymentReminder={() => workspace.setPaymentReminderCase(null)}
        onPaymentReminderSent={(message, type = 'success') => workspace.showAlert(message, type)}
      />

      {isAuth && <SyncStatusBar {...syncState} onSyncNow={() => void syncState.syncNow()} />}
    </div>
  );
}

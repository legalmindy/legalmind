import { useEffect, useMemo, useRef, useState } from 'react';
import { useToggle } from './hooks/useToggle';
import { HeaderBar } from './components/HeaderBar';
import { AlertBanner } from './components/AlertBanner';
import { LandingPage } from './pages/LandingPage';
import { AuthPages } from './pages/AuthPages';
import {
  DashboardPage,
  ClientsPage,
  CasesPage,
  SessionsPage,
  DocumentsPage,
  LawyersPage,
  ReportsPage,
  SubscriptionPage,
  ProfilePage,
  SettingsPage
} from './pages/WorkspacePages';
import { ArchivePage } from './pages/ArchivePage';
import { EmployeesPage } from './pages/EmployeesPage';
import { ClientModal, CaseModal, SessionModal, DocumentModal } from './components/Modals';
import { isValidYemeniPhone } from './utils/format';
import {
  INITIAL_CASES,
  INITIAL_CLIENTS,
  INITIAL_DOCUMENTS,
  INITIAL_EMPLOYEES,
  INITIAL_LAWYERS,
  INITIAL_NOTIFICATIONS,
  INITIAL_SESSIONS,
  MONTHLY_CHART_DATA,
  SUBSCRIPTION_PLANS
} from './constants/sampleData';
import type {
  AlertState,
  CaseRecord,
  Client,
  DocumentItem,
  Employee,
  PageId,
  SessionItem,
  SubscriptionPlan,
  User,
  UserRole
} from './types/app';

const initialClientForm: Omit<Client, 'id' | 'casesCount' | 'createdAt'> = {
  name: '',
  phone: '',
  email: '',
  address: '',
  type: 'فرد'
};

const initialCaseForm: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted'> = {
  title: '',
  clientId: '',
  category: 'تجاري',
  case_type: 'تجارية',
  case_stage: 'استئناف',
  total_amount: 0,
  paid_amount: 0,
  remaining_amount: 0,
  status: 'active',
  court: '',
  caseNo: '',
  lawyerId: '',
  description: '',
  notes: ''
};

const initialSessionForm: Omit<SessionItem, 'id' | 'caseTitle'> = {
  caseId: '',
  court: '',
  date: '',
  time: '',
  status: 'مجدولة',
  type: '',
  notes: ''
};

const initialDocumentForm: Pick<DocumentItem, 'title' | 'caseId' | 'category'> = {
  title: '',
  caseId: '',
  category: 'مستند قانوني'
};

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('landing');
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>('firm_manager');
  const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS);
  const [cases, setCases] = useState<CaseRecord[]>(INITIAL_CASES);
  const [sessions, setSessions] = useState<SessionItem[]>(INITIAL_SESSIONS);
  const [documents, setDocuments] = useState<DocumentItem[]>(INITIAL_DOCUMENTS);
  const [lawyers] = useState(INITIAL_LAWYERS);
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
  const [activeChartTab, setActiveChartTab] = useState<'cases' | 'revenue'>('cases');
  const [hoveredDataPoint, setHoveredDataPoint] = useState<null | (typeof MONTHLY_CHART_DATA)[number]>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [categoryFilter, setCategoryFilter] = useState('الكل');
  const [showClientModal, toggleClientModal, setShowClientModal] = useToggle(false);
  const [showCaseModal, toggleCaseModal, setShowCaseModal] = useToggle(false);
  const [showSessionModal, toggleSessionModal, setShowSessionModal] = useToggle(false);
  const [showDocumentModal, toggleDocumentModal, setShowDocumentModal] = useToggle(false);
  const [showNotificationDropdown, toggleNotificationDropdown, setShowNotificationDropdown] = useToggle(false);
  const [showUserDropdown, toggleUserDropdown, setShowUserDropdown] = useToggle(false);
  const [isMobileMenuOpen, toggleMobileMenu, setIsMobileMenuOpen] = useToggle(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingCase, setEditingCase] = useState<CaseRecord | null>(null);
  const [editingSession, setEditingSession] = useState<SessionItem | null>(null);
  const [newClient, setNewClient] = useState(initialClientForm);
  const [newCase, setNewCase] = useState(initialCaseForm);
  const [newSession, setNewSession] = useState(initialSessionForm);
  const [newDocument, setNewDocument] = useState(initialDocumentForm);
  const [alertMsg, setAlertMsg] = useState<AlertState | null>(null);
  const alertTimeout = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (alertTimeout.current) {
        window.clearTimeout(alertTimeout.current);
      }
    };
  }, []);

  const showAlert = (text: string, type: AlertState['type'] = 'success') => {
    setAlertMsg({ text, type });
    if (alertTimeout.current) {
      window.clearTimeout(alertTimeout.current);
    }
    alertTimeout.current = window.setTimeout(() => setAlertMsg(null), 4000);
  };

  const checkAccess = (allowedRoles: UserRole[]) => {
    return user !== null && allowedRoles.includes(user.role);
  };

  const handleLogin = (email: string, pass: string) => {
    if (!email.trim() || !pass.trim()) {
      showAlert('يرجى ملء جميع حقول الدخول.', 'error');
      return;
    }

    setUser({
      name: 'الأستاذ الدكتور نجيب الشراعي',
      email,
      role,
      plan: 'pro',
      company: 'مجموعة اليماني للمحاماة والاستشارات',
      phone: '+967770123456',
      licenseNo: 'م ع/١١٢/٢٠٢٣'
    });
    setCurrentPage('dashboard');
    showAlert('تم تسجيل الدخول بنجاح.', 'success');
  };

  const handleRegister = (name: string, email: string, company: string) => {
    if (!name.trim() || !email.trim() || !company.trim()) {
      showAlert('يرجى تعبئة كافة الحقول المطلوبة.', 'error');
      return;
    }

    setUser({
      name,
      email,
      role: 'firm_manager',
      plan: 'free',
      company,
      phone: '+967770000000',
      licenseNo: 'لم يقدم بعد'
    });
    setCurrentPage('dashboard');
    showAlert('تم إنشاء المكتب والبدء بالخطة التجريبية.', 'success');
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentPage('landing');
    showAlert('تم تسجيل الخروج بأمان.', 'info');
  };

  const saveClient = () => {
    if (!newClient.name.trim()) {
      showAlert('اسم الموكل مطلوب.', 'error');
      return;
    }
    if (!isValidYemeniPhone(newClient.phone)) {
      showAlert('رقم الهاتف اليمني غير صالح.', 'error');
      return;
    }

    if (editingClient) {
      setClients((current) => current.map((client) => (client.id === editingClient.id ? { ...client, ...newClient } : client)));
      showAlert('تم تحديث العميل بنجاح.', 'success');
    } else {
      setClients((current) => [
        {
          ...newClient,
          id: `${Date.now()}`,
          casesCount: 0,
          createdAt: new Date().toISOString().split('T')[0]
        },
        ...current
      ]);
      showAlert('تم إضافة العميل الجديد.', 'success');
    }

    setShowClientModal(false);
    setEditingClient(null);
    setNewClient(initialClientForm);
  };

  const deleteClient = (id: string) => {
    if (!checkAccess(['super_admin', 'admin', 'firm_manager'])) {
      showAlert('ليس لديك صلاحية حذف العملاء.', 'error');
      return;
    }

    const hasLinkedCase = cases.some((item) => item.clientId === id);
    if (hasLinkedCase) {
      showAlert('لا يمكن حذف العميل لأنه مرتبط بقضية حالية.', 'error');
      return;
    }
    setClients((current) => current.filter((client) => client.id !== id));
    showAlert('تم حذف العميل بنجاح.', 'info');
  };

  const saveCase = () => {
    if (!newCase.title.trim() || !newCase.clientId || !newCase.caseNo.trim() || !newCase.court.trim()) {
      showAlert('يرجى تعبئة كافة حقول القضية.', 'error');
      return;
    }

    const client = clients.find((item) => item.id === newCase.clientId);
    const clientName = client?.name ?? 'غير محدد';

    if (editingCase) {
      setCases((current) => current.map((item) => (item.id === editingCase.id ? { ...item, ...newCase, clientName } : item)));
      showAlert('تم تحديث معلومات القضية.', 'success');
    } else {
      setCases((current) => [
        {
          ...newCase,
          id: `${Date.now()}`,
          clientName,
          dateStarted: new Date().toISOString().split('T')[0]
        },
        ...current
      ]);
      setClients((current) => current.map((item) => (item.id === newCase.clientId ? { ...item, casesCount: item.casesCount + 1 } : item)));
      showAlert('تم فتح ملف القضية بنجاح.', 'success');
    }

    setShowCaseModal(false);
    setEditingCase(null);
    setNewCase(initialCaseForm);
  };

  const deleteCase = (id: string) => {
    if (!checkAccess(['super_admin', 'admin', 'firm_manager'])) {
      showAlert('ليس لديك صلاحية حذف القضايا.', 'error');
      return;
    }
    setCases((current) => current.filter((item) => item.id !== id));
    showAlert('تم حذف القضية.', 'info');
  };

  const saveSession = () => {
    if (!newSession.caseId || !newSession.date || !newSession.time || !newSession.court.trim() || !newSession.type.trim()) {
      showAlert('يرجى إكمال تفاصيل الجلسة.', 'error');
      return;
    }

    const relatedCase = cases.find((item) => item.id === newSession.caseId);
    const caseTitle = relatedCase ? relatedCase.title : 'قضية مجهولة';

    if (editingSession) {
      setSessions((current) => current.map((item) => (item.id === editingSession.id ? { ...item, ...newSession, caseTitle } : item)));
      showAlert('تم تحديث الجلسة.', 'success');
    } else {
      const id = `${Date.now()}`;
      setSessions((current) => [{ ...newSession, id, caseTitle }, ...current]);
      setNotifications((current) => [
        {
          id,
          title: 'موعد جلسة جديدة',
          message: `مجدولة لقضية "${caseTitle}" بتاريخ ${newSession.date} الساعة ${newSession.time}.`,
          time: 'الآن',
          read: false,
          type: 'session'
        },
        ...current
      ]);
      showAlert('تم حفظ الجلسة وإرسال التنبيه.', 'success');
    }

    setShowSessionModal(false);
    setEditingSession(null);
    setNewSession(initialSessionForm);
  };

  const deleteSession = (id: string) => {
    setSessions((current) => current.filter((session) => session.id !== id));
    showAlert('تم إلغاء الجلسة.', 'info');
  };

  const uploadDocument = () => {
    if (!newDocument.title.trim() || !newDocument.caseId) {
      showAlert('يرجى تحديد اسم المستند والقضية.', 'error');
      return;
    }

    const relatedCase = cases.find((item) => item.id === newDocument.caseId);
    const caseTitle = relatedCase ? relatedCase.title : 'قضية عامة';
    const title = newDocument.title.match(/\.(pdf|docx)$/i) ? newDocument.title : `${newDocument.title}.pdf`;

    setDocuments((current) => [
      {
        id: `${Date.now()}`,
        title,
        caseId: newDocument.caseId,
        caseTitle,
        category: newDocument.category,
        size: '1.2 MB',
        dateUploaded: new Date().toISOString().split('T')[0],
        url: '#'
      },
      ...current
    ]);

    setShowDocumentModal(false);
    setNewDocument(initialDocumentForm);
    showAlert('تم رفع المستند بنجاح.', 'success');
  };

  const markAllNotificationsRead = () => setNotifications((current) => current.map((item) => ({ ...item, read: true })));
  const markNotificationRead = (id: string) => setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));

  const filteredCases = useMemo(
    () =>
      cases.filter((item) => {
        const query = searchQuery.trim().toLowerCase();
        const matchesSearch =
          item.title.toLowerCase().includes(query) || item.clientName.toLowerCase().includes(query) || item.caseNo.includes(query);
        const matchesStatus = statusFilter === 'الكل' || item.status === statusFilter;
        const matchesCategory = categoryFilter === 'الكل' || item.category === categoryFilter;
        return matchesSearch && matchesStatus && matchesCategory;
      }),
    [cases, searchQuery, statusFilter, categoryFilter]
  );

  const filteredClients = useMemo(
    () =>
      clients.filter((client) => {
        const query = searchQuery.trim().toLowerCase();
        return (
          client.name.toLowerCase().includes(query) ||
          client.phone.includes(query) ||
          client.type.includes(query) ||
          client.email.toLowerCase().includes(query)
        );
      }),
    [clients, searchQuery]
  );

  const filteredArchiveCases = useMemo(
    () =>
      cases.filter((item) => item.status === 'archived' || item.status === 'closed'),
    [cases]
  );

  const stats = useMemo(
    () => ({
      totalClients: clients.length,
      totalCases: cases.length,
      activeCases: cases.filter((item) => item.status === 'active').length,
      upcomingSessions: sessions.filter((item) => item.status === 'مجدولة').length,
      totalDocuments: documents.length,
      lawyersCount: lawyers.length
    }),
    [clients.length, cases, sessions, documents.length, lawyers.length]
  );

  const handleRoleChange = (nextRole: UserRole) => {
    setRole(nextRole);
    if (user) {
      setUser({ ...user, role: nextRole });
    }
    showAlert(`تم تغيير صلاحية الحساب إلى ${nextRole}.`, 'info');
  };

  const openClientModalForEdit = (client: Client) => {
    setEditingClient(client);
    setNewClient({ name: client.name, phone: client.phone, email: client.email, address: client.address, type: client.type });
    setShowClientModal(true);
  };

  const openCaseModalForEdit = (caseRecord: CaseRecord) => {
    setEditingCase(caseRecord);
    setNewCase({
      title: caseRecord.title,
      clientId: caseRecord.clientId,
      category: caseRecord.category,
      status: caseRecord.status,
      court: caseRecord.court,
      caseNo: caseRecord.caseNo,
      lawyerId: caseRecord.lawyerId,
      description: caseRecord.description
    });
    setShowCaseModal(true);
  };

  const openSessionModalForEdit = (session: SessionItem) => {
    setEditingSession(session);
    setNewSession({
      caseId: session.caseId,
      court: session.court,
      date: session.date,
      time: session.time,
      status: session.status,
      type: session.type,
      notes: session.notes
    });
    setShowSessionModal(true);
  };

  const deleteEmployee = (id: string) => {
    setEmployees((current) => current.filter((employee) => employee.id !== id));
    showAlert('تم حذف الموظف من النظام.', 'info');
  };

  const toggleEmployeeStatus = (id: string) => {
    setEmployees((current) =>
      current.map((employee) =>
        employee.id === id
          ? {
              ...employee,
              status: employee.status === 'active' ? 'suspended' : 'active'
            }
          : employee
      )
    );
    showAlert('تم تحديث حالة الموظف.', 'success');
  };

  const editEmployee = (employee: Employee) => {
    showAlert(`تم فتح محرر بيانات ${employee.full_name}.`, 'info');
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-amber-500 selection:text-white">
      {alertMsg && <AlertBanner alert={alertMsg} />}

      {user && (
        <HeaderBar
          user={user}
          currentPage={currentPage}
          role={role}
          onChangePage={setCurrentPage}
          onRoleChange={handleRoleChange}
          notificationCount={notifications.filter((item) => !item.read).length}
          notifications={notifications}
          showNotificationDropdown={showNotificationDropdown}
          showUserDropdown={showUserDropdown}
          isMobileMenuOpen={isMobileMenuOpen}
          setShowNotificationDropdown={setShowNotificationDropdown}
          setShowUserDropdown={setShowUserDropdown}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
          markAllNotificationsRead={markAllNotificationsRead}
          markNotificationRead={markNotificationRead}
          handleLogout={handleLogout}
        />
      )}

      <main className="pb-16">
        {currentPage === 'landing' && <LandingPage onNavigate={setCurrentPage} />}

        {(currentPage === 'login' || currentPage === 'register' || currentPage === 'forgot') && (
          <AuthPages
            currentPage={currentPage}
            role={role}
            setRole={setRole}
            onNavigate={setCurrentPage}
            onLogin={handleLogin}
            onRegister={handleRegister}
          />
        )}

        {currentPage === 'dashboard' && user && (
          <DashboardPage
            user={user}
            sessions={sessions}
            documents={documents}
            activeChartTab={activeChartTab}
            hoveredDataPoint={hoveredDataPoint}
            setActiveChartTab={setActiveChartTab}
            setHoveredDataPoint={setHoveredDataPoint}
            stats={stats}
            monthlyData={MONTHLY_CHART_DATA}
            setCurrentPage={setCurrentPage}
            setShowClientModal={setShowClientModal}
            setShowCaseModal={setShowCaseModal}
            setShowSessionModal={setShowSessionModal}
          />
        )}

        {currentPage === 'clients' && user && (
          <ClientsPage
            clients={filteredClients}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            onCreateClient={() => {
              setEditingClient(null);
              setNewClient(initialClientForm);
              setShowClientModal(true);
            }}
            onEditClient={openClientModalForEdit}
            onDeleteClient={deleteClient}
          />
        )}

        {currentPage === 'cases' && user && (
          <CasesPage
            cases={filteredCases}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            categoryFilter={categoryFilter}
            onSearch={(value) => setSearchQuery(value)}
            onStatusFilterChange={setStatusFilter}
            onCategoryFilterChange={setCategoryFilter}
            onCreateCase={() => {
              setEditingCase(null);
              setNewCase(initialCaseForm);
              setShowCaseModal(true);
            }}
            onEditCase={openCaseModalForEdit}
            onDeleteCase={deleteCase}
          />
        )}

        {currentPage === 'archive' && user && (
          <ArchivePage
            cases={filteredArchiveCases}
            onRestore={(caseId) => {
              setCases((current) =>
                current.map((item) => (item.id === caseId ? { ...item, status: 'active', archive_date: undefined } : item))
              );
              showAlert('تمت استعادة القضية من الأرشيف.', 'success');
            }}
            onPermanentArchive={(caseId) => {
              setCases((current) => current.filter((item) => item.id !== caseId));
              showAlert('تمت الأرشفة النهائية للقضية.', 'info');
            }}
          />
        )}

        {currentPage === 'employees' && user && (
          <EmployeesPage
            employees={employees}
            onDelete={deleteEmployee}
            onToggleStatus={toggleEmployeeStatus}
            onEdit={editEmployee}
          />
        )}

        {currentPage === 'sessions' && user && (
          <SessionsPage
            sessions={sessions}
            onCreateSession={() => {
              setEditingSession(null);
              setNewSession(initialSessionForm);
              setShowSessionModal(true);
            }}
            onEditSession={openSessionModalForEdit}
            onDeleteSession={deleteSession}
          />
        )}

        {currentPage === 'documents' && user && (
          <DocumentsPage documents={documents} onCreateDocument={() => setShowDocumentModal(true)} />
        )}

        {currentPage === 'lawyers' && user && <LawyersPage lawyers={lawyers} />}

        {currentPage === 'reports' && user && <ReportsPage role={role} />}

        {currentPage === 'subscription' && user && <SubscriptionPage plans={SUBSCRIPTION_PLANS} />}

        {currentPage === 'profile' && user && <ProfilePage user={user} />}

        {currentPage === 'settings' && user && <SettingsPage user={user} />}
      </main>

      <ClientModal open={showClientModal} client={editingClient} formState={newClient} onChange={setNewClient} onSave={saveClient} onClose={() => setShowClientModal(false)} />
      <CaseModal
        open={showCaseModal}
        caseRecord={editingCase}
        formState={newCase}
        clients={clients}
        lawyers={lawyers}
        onChange={setNewCase}
        onSave={saveCase}
        onClose={() => setShowCaseModal(false)}
      />
      <SessionModal open={showSessionModal} session={editingSession} formState={newSession} cases={cases} onChange={setNewSession} onSave={saveSession} onClose={() => setShowSessionModal(false)} />
      <DocumentModal open={showDocumentModal} formState={newDocument} cases={cases} onChange={setNewDocument} onSave={uploadDocument} onClose={() => setShowDocumentModal(false)} />
    </div>
  );
}

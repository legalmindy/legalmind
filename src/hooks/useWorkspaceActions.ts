import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToggle } from './useToggle';
import { isValidYemeniPhone } from '../utils/format';
import { isValidEmail } from '../lib/sanitize';
import { canManageCases, canManageClients, canManageOffice, checkRoleAccess } from '../lib/api';
import { formatCaseSaveError } from '../lib/supabaseQueryHelpers';
import { toArabicQueryError } from '../components/QueryErrorBanner';
import { applyFirmRoleToEmployee } from '../lib/permissions';
import {
  initialCaseForm,
  initialClientForm,
  initialEmployeeForm,
  initialSessionForm
} from '../app/workspaceForms';
import type {
  AlertState,
  CaseRecord,
  Client,
  Employee,
  Invitation,
  SessionItem,
  User,
  UserRole
} from '../types/app';
import type {
  useCaseMutations,
  useClientMutations,
  useDocumentMutations,
  useEmployeeMutations,
  useNotificationMutations,
  useSessionMutations
} from './useSupabaseQueries';

type ClientMutations = ReturnType<typeof useClientMutations>;
type CaseMutations = ReturnType<typeof useCaseMutations>;
type SessionMutations = ReturnType<typeof useSessionMutations>;
type DocumentMutations = ReturnType<typeof useDocumentMutations>;
type EmployeeMutations = ReturnType<typeof useEmployeeMutations>;
type NotificationMutations = ReturnType<typeof useNotificationMutations>;

interface UseWorkspaceActionsInput {
  user: User | null;
  cases: CaseRecord[];
  remindersEnabled: boolean;
  clientMutations: ClientMutations;
  caseMutations: CaseMutations;
  sessionMutations: SessionMutations;
  documentMutations: DocumentMutations;
  employeeMutations: EmployeeMutations;
  notificationMutations: NotificationMutations;
}

export function useWorkspaceActions({
  user,
  cases,
  remindersEnabled,
  clientMutations,
  caseMutations,
  sessionMutations,
  documentMutations,
  employeeMutations,
  notificationMutations
}: UseWorkspaceActionsInput) {
  const queryClient = useQueryClient();
  const alertTimeout = useRef<number | null>(null);

  const [activeChartTab, setActiveChartTab] = useState<'cases' | 'revenue'>('cases');
  const [hoveredDataPoint, setHoveredDataPoint] = useState<{
    month: string;
    cases: number;
    resolved: number;
    revenue: number;
  } | null>(null);
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

  const showAlert = useCallback((text: string, type: AlertState['type'] = 'success') => {
    setAlertMsg({ text, type });
    if (alertTimeout.current) window.clearTimeout(alertTimeout.current);
    alertTimeout.current = window.setTimeout(() => setAlertMsg(null), 4000);
  }, []);

  const checkAccess = useCallback(
    (allowedRoles: UserRole[]) => user !== null && checkRoleAccess(user.role, allowedRoles),
    [user]
  );

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
    if (!newEmployee.firm_role_id) {
      showAlert('اختر دوراً للعضو من قائمة أدوار المكتب.', 'error'); return;
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
        const { firm_role_id, role: _role, ...profileChanges } = newEmployee;
        await employeeMutations.updateEmployee.mutateAsync({ ...editingEmployee, ...profileChanges });
        if (firm_role_id && firm_role_id !== editingEmployee.firm_role_id) {
          await applyFirmRoleToEmployee(editingEmployee.id, firm_role_id);
          void queryClient.invalidateQueries({ queryKey: ['employees'] });
        }
        showAlert('تم تحديث بيانات عضو الفريق.', 'success');
      } else {
        const invitation = await employeeMutations.inviteEmployee.mutateAsync({
          email: newEmployee.email.trim(),
          firmRoleId: newEmployee.firm_role_id!,
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

  return {
    activeChartTab,
    setActiveChartTab,
    hoveredDataPoint,
    setHoveredDataPoint,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    showClientModal,
    setShowClientModal,
    showCaseModal,
    setShowCaseModal,
    showSessionModal,
    setShowSessionModal,
    showDocumentModal,
    setShowDocumentModal,
    showEmployeeModal,
    setShowEmployeeModal,
    showNotificationDropdown,
    setShowNotificationDropdown,
    showUserDropdown,
    setShowUserDropdown,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    editingClient,
    setEditingClient,
    editingCase,
    setEditingCase,
    archivingCase,
    setArchivingCase,
    archiveNotes,
    setArchiveNotes,
    showArchiveModal,
    setShowArchiveModal,
    editingSession,
    setEditingSession,
    editingEmployee,
    setEditingEmployee,
    newClient,
    setNewClient,
    newCase,
    setNewCase,
    newSession,
    setNewSession,
    newDocument,
    setNewDocument,
    newEmployee,
    setNewEmployee,
    alertMsg,
    documentFile,
    setDocumentFile,
    reportClient,
    setReportClient,
    pendingInvitationShare,
    setPendingInvitationShare,
    paymentReminderCase,
    setPaymentReminderCase,
    showAlert,
    saveClient,
    deleteClient,
    saveCase,
    deleteCase,
    openArchiveCase,
    confirmArchiveCase,
    saveSession,
    deleteSession,
    uploadDocument,
    saveEmployee
  };
}

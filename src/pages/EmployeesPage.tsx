import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Plus,
  UserCheck,
  UserX,
  Edit3,
  Trash2,
  Mail,
  Ban,
  Copy,
  RefreshCw,
  Users,
  UserCog,
  Shield
} from 'lucide-react';
import { FirmCodeCard } from '../components/FirmCodeCard';
import { OfficeManagerPanel } from './OfficeManagerPage';
import { EmployeePermissionsModal } from '../components/EmployeePermissionsModal';
import { useMyPermissions } from '../hooks/useMyPermissions';
import { isFirmManagerRole } from '../lib/roleAccess';
import {
  approveMemberRegistration,
  fetchPendingMemberRegistrations,
  rejectMemberRegistration
} from '../lib/memberRegistration';
import { toArabicQueryError } from '../components/QueryErrorBanner';
import { resolveRoleDisplayName, LEGACY_ROLE_LABELS } from '../lib/roleLabels';
import type { CaseRecord, Employee, Invitation, Lawyer, UserRole } from '../types/app';

type EmployeesSection = 'team' | 'manager';

interface EmployeesPageProps {
  employees: Employee[];
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onEdit: (employee: Employee) => void;
  onInvite: () => void;
  invitations: Invitation[];
  onRevokeInvitation: (id: string) => void;
  onResendInvitation: (id: string) => void;
  onCopyInvitation: (url: string) => void;
  firmCode?: string;
  firmName?: string;
  onFirmCodeCopied?: (message: string) => void;
  userRole: UserRole;
  cases?: CaseRecord[];
  lawyers?: Lawyer[];
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
  initialSection?: EmployeesSection;
}

export function EmployeesPage({
  employees,
  onDelete,
  onToggleStatus,
  onEdit,
  onInvite,
  invitations,
  onRevokeInvitation,
  onResendInvitation,
  onCopyInvitation,
  firmCode,
  firmName,
  onFirmCodeCopied,
  userRole,
  cases = [],
  lawyers = [],
  onNotify,
  initialSection = 'team'
}: EmployeesPageProps) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [section, setSection] = useState<EmployeesSection>(initialSection);
  const [permissionsEmployee, setPermissionsEmployee] = useState<Employee | null>(null);

  const { can } = useMyPermissions();
  const canManagePermissions = can('users.permissions', userRole) || isFirmManagerRole(userRole);
  const canManageTeam = can('users.manage', userRole) || isFirmManagerRole(userRole);
  const canInvite = can('users.invite', userRole) || isFirmManagerRole(userRole);
  const showManagerTab = canManagePermissions;
  const showPendingApprovals = isFirmManagerRole(userRole);
  const queryClient = useQueryClient();
  const activeCount = employees.filter((item) => item.status === 'active').length;

  const { data: pendingMembers = [], refetch: refetchPendingMembers } = useQuery({
    queryKey: ['pending-member-registrations'],
    queryFn: fetchPendingMemberRegistrations,
    enabled: showPendingApprovals
  });

  const filteredEmployees = useMemo(() => {
    return employees.filter((item) => {
      const query = search.trim().toLowerCase();
      const matches =
        item.full_name.toLowerCase().includes(query) ||
        item.email.toLowerCase().includes(query) ||
        item.phone.includes(query);
      const matchesRole = roleFilter === 'الكل' || item.role === roleFilter;
      const matchesStatus = statusFilter === 'الكل' || item.status === statusFilter;
      return matches && matchesRole && matchesStatus;
    });
  }, [employees, search, roleFilter, statusFilter]);

  const sections: Array<{ id: EmployeesSection; label: string; icon: typeof Users; managerOnly?: boolean }> = [
    { id: 'team', label: 'الموظفون والدعوات', icon: Users },
    { id: 'manager', label: 'قوالب الصلاحيات', icon: UserCog, managerOnly: true }
  ];

  return (
    <div className="mx-auto mt-6 max-w-7xl space-y-6 px-4 text-right sm:px-6 lg:px-8" dir="rtl">
      {/* Header */}
      <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-[#7A1F2B]/10 p-2">
                <Shield className="h-5 w-5 text-[#7A1F2B]" />
              </div>
              <h1 className="text-2xl font-black text-slate-900">إدارة الفريق القانوني</h1>
            </div>
            <p className="text-xs text-slate-500">
              الموظفون، الدعوات، ولوحة مدير المكتب — في مكان واحد.
            </p>
          </div>
          {section === 'team' && canInvite ? (
            <button
              type="button"
              onClick={onInvite}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 transition-all hover:bg-amber-600"
            >
              <Plus className="h-4 w-4" />
              إضافة موظف جديد
            </button>
          ) : null}
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 border-t border-slate-100 sm:grid-cols-4">
          {[
            { label: 'إجمالي الفريق', value: employees.length },
            { label: 'نشط', value: activeCount },
            { label: 'دعوات معلقة', value: invitations.filter((i) => i.status === 'pending').length },
            { label: 'طلبات انضمام', value: pendingMembers.length },
            { label: 'المحامون', value: lawyers.length || employees.filter((e) => e.role === 'lawyer').length }
          ].map((stat) => (
            <div key={stat.label} className="border-l border-slate-100 px-4 py-3 first:border-l-0">
              <p className="text-[10px] font-bold text-slate-400">{stat.label}</p>
              <p className="text-lg font-black text-slate-900">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 overflow-x-auto border-t border-slate-100 bg-slate-50/80 p-2 scrollbar-none">
          {sections
            .filter((item) => !item.managerOnly || showManagerTab)
            .map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
                  section === id
                    ? 'bg-[#7A1F2B] text-white shadow-md shadow-[#7A1F2B]/20'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
        </div>
      </div>

      {section === 'manager' && showManagerTab ? (
        <OfficeManagerPanel
          embedded
          role={userRole}
          canManagePermissions={canManagePermissions}
          cases={cases}
          lawyers={lawyers}
          onNotify={onNotify ?? (() => undefined)}
        />
      ) : null}

      {section === 'team' ? (
        <>
          {showPendingApprovals && pendingMembers.length > 0 ? (
            <div className="overflow-hidden rounded-3xl border border-amber-200 bg-amber-50/60 shadow-sm">
              <div className="border-b border-amber-200/80 px-5 py-4">
                <h2 className="text-sm font-black text-amber-950">طلبات انضمام بانتظار الموافقة</h2>
                <p className="mt-1 text-[11px] text-amber-900/80">
                  أعضاء سجّلوا عبر كود المكتب واختاروا صلاحيتهم — يحتاجون موافقة مالك المكتب.
                </p>
              </div>
              <div className="divide-y divide-amber-100">
                {pendingMembers.map((member) => (
                  <div key={member.employeeId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div>
                      <p className="font-bold text-slate-900">{member.fullName}</p>
                      <p className="text-xs text-slate-600">{member.email}</p>
                      <p className="mt-1 text-[11px] font-bold text-[#7A1F2B]">
                        {member.roleName ? `${member.roleName} (قالب)` : 'عضو بالمكتب'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void approveMemberRegistration(member.employeeId)
                            .then(async () => {
                              await refetchPendingMembers();
                              void queryClient.invalidateQueries({ queryKey: ['employees'] });
                              onNotify?.('تمت الموافقة وتفعيل العضو.', 'success');
                            })
                            .catch((err) => onNotify?.(toArabicQueryError(err, 'الموافقة على العضو'), 'error'))
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        موافقة
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void rejectMemberRegistration(member.employeeId)
                            .then(async () => {
                              await refetchPendingMembers();
                              onNotify?.('تم رفض طلب الانضمام.', 'info');
                            })
                            .catch((err) => onNotify?.(toArabicQueryError(err, 'رفض العضو'), 'error'))
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-bold text-rose-700"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        رفض
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {firmCode ? (
            <FirmCodeCard firmCode={firmCode} firmName={firmName} onCopied={onFirmCodeCopied} />
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="flex items-center gap-3 rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-right text-xs outline-none"
                placeholder="بحث عن اسم، بريد أو هاتف"
              />
            </div>
            <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <label className="mb-2 block text-[10px] text-slate-500">فلتر الدور</label>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-right outline-none"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option>الكل</option>
                <option value="firm_manager">مدير المكتب</option>
                <option value="admin">أدمن</option>
                <option value="lawyer">محامي</option>
                <option value="assistant">مساعد</option>
              </select>
            </div>
            <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
              <label className="mb-2 block text-[10px] text-slate-500">فلتر الحالة</label>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-right outline-none"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option>الكل</option>
                <option value="active">نشط</option>
                <option value="pending_approval">بانتظار الموافقة</option>
                <option value="suspended">معلق</option>
                <option value="disabled">معطل</option>
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-black text-slate-900">إدارة الدعوات</h2>
                <p className="mt-1 text-[11px] text-slate-500">دعوات آمنة للمحامين والمساعدين داخل المكتب.</p>
              </div>
              <Mail className="h-5 w-5 text-indigo-700" />
            </div>
            {invitations.length === 0 ? (
              <p className="p-5 text-xs text-slate-500">لا توجد دعوات معلقة حالياً.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-bold">البريد</th>
                      <th className="px-4 py-3 font-bold">الاسم</th>
                      <th className="px-4 py-3 font-bold">الدور</th>
                      <th className="px-4 py-3 font-bold">الحالة</th>
                      <th className="px-4 py-3 font-bold">تنتهي في</th>
                      <th className="px-4 py-3 text-center font-bold">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((invite) => (
                      <tr key={invite.id} className="border-b border-slate-100">
                        <td className="px-4 py-3 font-mono text-slate-600">{invite.email}</td>
                        <td className="px-4 py-3 font-bold text-slate-800">{invite.fullName || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700">
                            {LEGACY_ROLE_LABELS[invite.role as UserRole] ?? invite.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${
                              invite.status === 'pending'
                                ? 'bg-amber-50 text-amber-700'
                                : invite.status === 'accepted'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {invite.status === 'pending'
                              ? 'قيد الانتظار'
                              : invite.status === 'accepted'
                                ? 'مقبولة'
                                : invite.status === 'expired'
                                  ? 'منتهية'
                                  : 'ملغاة'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{invite.expiresAt.split('T')[0]}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {invite.inviteUrl ? (
                              <button
                                type="button"
                                onClick={() => onCopyInvitation(invite.inviteUrl ?? '')}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 font-bold text-indigo-700 hover:bg-indigo-100"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                نسخ
                              </button>
                            ) : null}
                            {invite.status !== 'accepted' ? (
                              <button
                                type="button"
                                onClick={() => onResendInvitation(invite.id)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 font-bold text-amber-700 hover:bg-amber-100"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                إعادة
                              </button>
                            ) : null}
                            {invite.status === 'pending' ? (
                              <button
                                type="button"
                                onClick={() => onRevokeInvitation(invite.id)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 font-bold text-rose-600 hover:bg-rose-100"
                              >
                                <Ban className="h-3.5 w-3.5" />
                                إلغاء
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-100 bg-slate-50 uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3.5 font-bold">الاسم</th>
                    <th className="px-4 py-3.5 font-bold">الإيميل</th>
                    <th className="px-4 py-3.5 font-bold">الهاتف</th>
                    <th className="px-4 py-3.5 font-bold">الدور</th>
                    <th className="px-4 py-3.5 font-bold">الحالة</th>
                    <th className="px-4 py-3.5 text-center font-bold">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((employee) => (
                    <tr key={employee.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3.5 font-semibold text-slate-900">{employee.full_name}</td>
                      <td className="px-4 py-3.5 text-slate-500">{employee.email}</td>
                      <td className="px-4 py-3.5 font-mono text-slate-600">{employee.phone}</td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700">
                          {resolveRoleDisplayName(employee.firmRoleName, employee.firmRoleSlug, employee.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            employee.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700'
                              : employee.status === 'pending_approval'
                                ? 'bg-sky-50 text-sky-700'
                                : employee.status === 'suspended'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {employee.status === 'active'
                            ? 'نشط'
                            : employee.status === 'pending_approval'
                              ? 'بانتظار الموافقة'
                              : employee.status === 'suspended'
                                ? 'معلق'
                                : 'معطل'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {canManagePermissions ? (
                            <button
                              type="button"
                              onClick={() => setPermissionsEmployee(employee)}
                              className="rounded p-1.5 text-slate-500 transition-colors hover:bg-[#7A1F2B]/10 hover:text-[#7A1F2B]"
                              title="صلاحيات الموظف"
                            >
                              <Shield className="h-4 w-4" />
                            </button>
                          ) : null}
                          {canManageTeam ? (
                            <>
                              <button
                                type="button"
                                onClick={() => onEdit(employee)}
                                className="rounded p-1.5 text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                                title="تعديل"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onToggleStatus(employee.id)}
                                className="rounded p-1.5 text-slate-500 transition-colors hover:bg-amber-50 hover:text-amber-600"
                                title="تبديل الحالة"
                              >
                                <UserCheck className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDelete(employee.id)}
                                className="rounded p-1.5 text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                                title="حذف"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-slate-700 shadow-sm">
              <div className="mb-2 flex items-center gap-3 text-sm font-bold">
                <UserCheck className="h-4 w-4" />
                فريق قانوني نشط
              </div>
              <p className="text-[11px]">
                معدل تفعيل الموظفين: {activeCount}/{employees.length}
              </p>
            </div>
            <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 text-slate-700 shadow-sm">
              <div className="mb-2 flex items-center gap-3 text-sm font-bold">
                <UserX className="h-4 w-4" />
                حالات التعليق والتعطيل
              </div>
              <p className="text-[11px]">
                الموظفون المعلقون أو المعطلون يمكنهم فقط عرض البيانات المحدودة ومتابعة الجلسات.
              </p>
            </div>
          </div>
        </>
      ) : null}

      <EmployeePermissionsModal
        open={Boolean(permissionsEmployee)}
        employeeId={permissionsEmployee?.id ?? null}
        employeeName={permissionsEmployee?.full_name ?? ''}
        onClose={() => setPermissionsEmployee(null)}
        onNotify={onNotify}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['my-permissions'] })}
      />
    </div>
  );
}

import { useMemo, useState } from 'react';
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
import { isFirmManagerRole } from '../lib/roleAccess';
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

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'سوبر أدمن',
  admin: 'أدمن',
  firm_manager: 'مدير المكتب',
  lawyer: 'محامي',
  assistant: 'مساعد'
};

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

  const showManagerTab = isFirmManagerRole(userRole);
  const activeCount = employees.filter((item) => item.status === 'active').length;

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
    { id: 'manager', label: 'مدير المكتب', icon: UserCog, managerOnly: true }
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
          {section === 'team' ? (
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
          cases={cases}
          lawyers={lawyers}
          onNotify={onNotify ?? (() => undefined)}
        />
      ) : null}

      {section === 'team' ? (
        <>
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
                            {ROLE_LABELS[invite.role] ?? invite.role}
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
                          {ROLE_LABELS[employee.role] ?? employee.role}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${
                            employee.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700'
                              : employee.status === 'suspended'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {employee.status === 'active' ? 'نشط' : employee.status === 'suspended' ? 'معلق' : 'معطل'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
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
    </div>
  );
}

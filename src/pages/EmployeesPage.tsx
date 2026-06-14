import { useMemo, useState } from 'react';
import { Search, Plus, UserCheck, UserX, Edit3, Trash2, Mail, Ban, Copy, RefreshCw } from 'lucide-react';
import { FirmCodeCard } from '../components/FirmCodeCard';
import type { Employee, Invitation } from '../types/app';

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
}

export function EmployeesPage({ employees, onDelete, onToggleStatus, onEdit, onInvite, invitations, onRevokeInvitation, onResendInvitation, onCopyInvitation, firmCode, firmName, onFirmCodeCopied }: EmployeesPageProps) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right">
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col lg:flex-row justify-between gap-4 items-start lg:items-center">
        <div>
          <h1 className="text-2xl font-black text-slate-900">إدارة المحامين والفريق القانوني</h1>
          <p className="text-xs text-slate-500 mt-1">سجل صلاحيات الموظفين وادارة حالات التعليق والتفعيل وسياسات الوصول.</p>
        </div>
        <button type="button" onClick={onInvite} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-600 transition-all">
          <Plus className="w-4 h-4" /> إضافة موظف جديد
        </button>
      </div>

      {firmCode ? (
        <FirmCodeCard firmCode={firmCode} firmName={firmName} onCopied={onFirmCodeCopied} />
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent outline-none text-xs text-right"
            placeholder="بحث عن اسم، بريد أو هاتف"
          />
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
          <label className="block text-[10px] text-slate-500 mb-2">فلتر الدور</label>
          <select className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-right" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option>الكل</option>
            <option value="super_admin">سوبر أدمن</option>
            <option value="admin">أدمن</option>
            <option value="lawyer">محامي</option>
            <option value="assistant">مساعد</option>
          </select>
        </div>
        <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-sm">
          <label className="block text-[10px] text-slate-500 mb-2">فلتر الحالة</label>
          <select className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-right" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option>الكل</option>
            <option value="active">نشط</option>
            <option value="suspended">معلق</option>
            <option value="disabled">معطل</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-black text-slate-900 text-sm">إدارة الدعوات</h2>
            <p className="text-[11px] text-slate-500 mt-1">دعوات آمنة للمحامين والمساعدين داخل المكتب.</p>
          </div>
          <Mail className="w-5 h-5 text-indigo-700" />
        </div>
        {invitations.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">لا توجد دعوات معلقة حالياً.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4 font-bold">البريد</th>
                  <th className="py-3 px-4 font-bold">الاسم</th>
                  <th className="py-3 px-4 font-bold">الدور</th>
                  <th className="py-3 px-4 font-bold">الحالة</th>
                  <th className="py-3 px-4 font-bold">تنتهي في</th>
                  <th className="py-3 px-4 font-bold text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invite) => (
                  <tr key={invite.id} className="border-b border-slate-100">
                    <td className="py-3 px-4 font-mono text-slate-600">{invite.email}</td>
                    <td className="py-3 px-4 font-bold text-slate-800">{invite.fullName || '—'}</td>
                    <td className="py-3 px-4"><span className="inline-flex rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-1 text-[10px] font-bold">{invite.role}</span></td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${invite.status === 'pending' ? 'bg-amber-50 text-amber-700' : invite.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {invite.status === 'pending' ? 'قيد الانتظار' : invite.status === 'accepted' ? 'مقبولة' : invite.status === 'expired' ? 'منتهية' : 'ملغاة'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500">{invite.expiresAt.split('T')[0]}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {invite.inviteUrl && (
                          <button type="button" onClick={() => onCopyInvitation(invite.inviteUrl ?? '')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 font-bold">
                            <Copy className="w-3.5 h-3.5" /> نسخ
                          </button>
                        )}
                        {invite.status !== 'accepted' && (
                          <button type="button" onClick={() => onResendInvitation(invite.id)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-amber-700 bg-amber-50 hover:bg-amber-100 font-bold">
                            <RefreshCw className="w-3.5 h-3.5" /> إعادة
                          </button>
                        )}
                        {invite.status === 'pending' && (
                          <button type="button" onClick={() => onRevokeInvitation(invite.id)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 font-bold">
                            <Ban className="w-3.5 h-3.5" /> إلغاء
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-4 font-bold">الاسم</th>
                <th className="py-3.5 px-4 font-bold">الإيميل</th>
                <th className="py-3.5 px-4 font-bold">الهاتف</th>
                <th className="py-3.5 px-4 font-bold">الدور</th>
                <th className="py-3.5 px-4 font-bold">الحالة</th>
                <th className="py-3.5 px-4 font-bold text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="py-3.5 px-4 font-semibold text-slate-900">{employee.full_name}</td>
                  <td className="py-3.5 px-4 text-slate-500">{employee.email}</td>
                  <td className="py-3.5 px-4 font-mono text-slate-600">{employee.phone}</td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-1 text-[10px] font-bold">
                      {employee.role}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${employee.status === 'active' ? 'bg-emerald-50 text-emerald-700' : employee.status === 'suspended' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                      {employee.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button type="button" onClick={() => onEdit(employee)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="تعديل"><Edit3 className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onToggleStatus(employee.id)} className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors" title="تبديل الحالة"><UserCheck className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onDelete(employee.id)} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors" title="حذف"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-emerald-50 p-4 rounded-3xl border border-emerald-100 shadow-sm text-slate-700">
          <div className="flex items-center gap-3 text-sm font-bold mb-2"><UserCheck className="w-4 h-4" /> فريق قانوني نشط</div>
          <p className="text-[11px]">معدل تفعيل الموظفين: {employees.filter((item) => item.status === 'active').length}/{employees.length}</p>
        </div>
        <div className="bg-amber-50 p-4 rounded-3xl border border-amber-100 shadow-sm text-slate-700">
          <div className="flex items-center gap-3 text-sm font-bold mb-2"><UserX className="w-4 h-4" /> حالات التعليق والتعطيل</div>
          <p className="text-[11px]">الموظفون المعلقون أو المعطلون يمكنهم فقط عرض البيانات المحدودة ومتابعة الجلسات.</p>
        </div>
      </div>
    </div>
  );
}

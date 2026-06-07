import { useMemo, useState } from 'react';
import { Search, Plus, UserCheck, UserX, UserMinus, Edit3, Trash2 } from 'lucide-react';
import type { Employee } from '../types/app';

interface EmployeesPageProps {
  employees: Employee[];
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onEdit: (employee: Employee) => void;
}

export function EmployeesPage({ employees, onDelete, onToggleStatus, onEdit }: EmployeesPageProps) {
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
        <button type="button" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-600 transition-all">
          <Plus className="w-4 h-4" /> إضافة موظف جديد
        </button>
      </div>

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

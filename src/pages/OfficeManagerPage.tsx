import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Check,
  Loader2,
  Plus,
  Shield,
  UserCog,
  Users
} from 'lucide-react';
import type { CaseRecord, Lawyer, PermissionKey, UserRole } from '../types/app';
import { assignCaseLawyer } from '../lib/api';
import {
  PERMISSION_LABELS,
  createCustomFirmRole,
  fetchFirmRoles,
  updateFirmRolePermissions
} from '../lib/permissions';
import { isFirmManagerRole } from '../lib/roleAccess';
import { toArabicQueryError } from '../components/QueryErrorBanner';

type ManagerTab = 'cases' | 'lawyers' | 'permissions';

interface OfficeManagerPageProps {
  role: UserRole;
  cases: CaseRecord[];
  lawyers: Lawyer[];
  onNotify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[];

export function OfficeManagerPage({ role, cases, lawyers, onNotify }: OfficeManagerPageProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ManagerTab>('cases');
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<Record<string, boolean>>({});
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleSlug, setNewRoleSlug] = useState('');
  const [creatingRole, setCreatingRole] = useState(false);

  const accessDenied = !isFirmManagerRole(role);

  const { data: firmRoles = [], isLoading: rolesLoading, refetch: refetchRoles } = useQuery({
    queryKey: ['firm-roles'],
    queryFn: fetchFirmRoles,
    enabled: !accessDenied && tab === 'permissions'
  });

  const activeCases = useMemo(
    () => cases.filter((c) => c.status === 'active'),
    [cases]
  );

  const lawyerCaseCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of activeCases) {
      if (c.lawyerId) map.set(c.lawyerId, (map.get(c.lawyerId) ?? 0) + 1);
    }
    return map;
  }, [activeCases]);

  const unassignedCount = useMemo(
    () => activeCases.filter((c) => !c.lawyerId).length,
    [activeCases]
  );

  const handleReassign = useCallback(
    async (caseId: string, lawyerId: string) => {
      setReassigningId(caseId);
      try {
        await assignCaseLawyer(caseId, lawyerId || null);
        await queryClient.invalidateQueries({ queryKey: ['cases'] });
        onNotify('تم تحديث المحامي المكلف بالقضية.', 'success');
      } catch (err) {
        onNotify(toArabicQueryError(err, 'إعادة توزيع القضية'), 'error');
      } finally {
        setReassigningId(null);
      }
    },
    [onNotify, queryClient]
  );

  const selectRole = useCallback(
    (roleId: string) => {
      setSelectedRoleId(roleId);
      const roleRow = firmRoles.find((r) => r.id === roleId);
      setDraftPermissions({ ...(roleRow?.permissions ?? {}) });
    },
    [firmRoles]
  );

  const togglePermission = (key: PermissionKey) => {
    setDraftPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const saveRolePermissions = async () => {
    if (!selectedRoleId) return;
    setSavingRoleId(selectedRoleId);
    try {
      await updateFirmRolePermissions(selectedRoleId, draftPermissions);
      await refetchRoles();
      onNotify('تم حفظ صلاحيات الدور.', 'success');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'حفظ الصلاحيات'), 'error');
    } finally {
      setSavingRoleId(null);
    }
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    const slug = newRoleSlug.trim().toLowerCase().replace(/\s+/g, '_');
    if (!name || !slug) {
      onNotify('أدخل اسم الدور والمعرّف.', 'error');
      return;
    }
    setCreatingRole(true);
    try {
      const roleId = await createCustomFirmRole(name, slug, draftPermissions);
      setNewRoleName('');
      setNewRoleSlug('');
      await refetchRoles();
      if (roleId) selectRole(roleId);
      onNotify('تم إنشاء الدور المخصص.', 'success');
    } catch (err) {
      onNotify(toArabicQueryError(err, 'إنشاء الدور'), 'error');
    } finally {
      setCreatingRole(false);
    }
  };

  if (accessDenied) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center" dir="rtl">
        <Shield className="mx-auto h-12 w-12 text-rose-500" />
        <h2 className="mt-4 text-lg font-black text-slate-800">لوحة مدير المكتب</h2>
        <p className="mt-2 text-sm text-slate-500">هذه الصفحة متاحة لمدير المكتب فقط.</p>
      </div>
    );
  }

  const tabs: { id: ManagerTab; label: string; icon: typeof Briefcase }[] = [
    { id: 'cases', label: 'توزيع القضايا', icon: Briefcase },
    { id: 'lawyers', label: 'المحامون', icon: Users },
    { id: 'permissions', label: 'مصفوفة الصلاحيات', icon: UserCog }
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-[#7A1F2B] via-[#641923] to-slate-900 p-6 text-white shadow-xl">
        <h1 className="text-2xl font-black">لوحة مدير المكتب</h1>
        <p className="mt-1 text-xs text-white/80">
          إدارة المحامين، إعادة توزيع القضايا والموكلين، وتخصيص الأدوار والصلاحيات.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <span className="rounded-lg bg-white/10 px-3 py-1.5 font-bold">{activeCases.length} قضية نشطة</span>
          <span className="rounded-lg bg-white/10 px-3 py-1.5 font-bold">{lawyers.length} محامٍ</span>
          <span className="rounded-lg bg-amber-400/20 px-3 py-1.5 font-bold text-amber-100">{unassignedCount} بدون محامٍ</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors ${
              tab === id ? 'bg-[#7A1F2B] text-white shadow' : 'bg-white text-slate-600 border border-slate-100 hover:bg-slate-50'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'cases' && (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-black text-slate-900">إعادة توزيع القضايا بين المحامين</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">اختر المحامي المكلف — يُسجّل التغيير تلقائياً في الجدول الزمني للقضية.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-bold">القضية</th>
                  <th className="px-4 py-3 font-bold">الموكل</th>
                  <th className="px-4 py-3 font-bold">المحامي الحالي</th>
                  <th className="px-4 py-3 font-bold">تعيين محامٍ</th>
                </tr>
              </thead>
              <tbody>
                {activeCases.map((c) => {
                  const currentLawyer = lawyers.find((l) => l.id === c.lawyerId);
                  return (
                    <tr key={c.id} className="border-t border-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-800">{c.title}</p>
                        <p className="text-[10px] text-slate-400">{c.caseNo}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.clientName}</td>
                      <td className="px-4 py-3">
                        {currentLawyer ? (
                          <span className="font-bold text-indigo-700">{currentLawyer.name}</span>
                        ) : (
                          <span className="text-amber-600">غير معيّن</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={c.lawyerId ?? ''}
                            disabled={reassigningId === c.id}
                            onChange={(e) => void handleReassign(c.id, e.target.value)}
                            className="min-w-[140px] rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-[#7A1F2B]"
                          >
                            <option value="">— بدون محامٍ —</option>
                            {lawyers.map((l) => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                          </select>
                          {reassigningId === c.id && <Loader2 className="h-4 w-4 animate-spin text-[#7A1F2B]" />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {activeCases.length === 0 && (
              <p className="py-12 text-center text-sm text-slate-400">لا توجد قضايا نشطة.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'lawyers' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lawyers.map((lawyer) => {
            const assigned = lawyerCaseCounts.get(lawyer.id) ?? 0;
            return (
              <div key={lawyer.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-black text-slate-900">{lawyer.name}</h3>
                    <p className="text-[11px] text-slate-500">{lawyer.specialization || lawyer.role}</p>
                  </div>
                  <span className="rounded-lg bg-[#7A1F2B]/10 px-2 py-1 text-[10px] font-bold text-[#7A1F2B]">
                    {assigned} قضية
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-400">النجاح</p>
                    <p className="font-bold text-slate-800">{lawyer.success_rate ?? '—'}%</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-400">الحضور</p>
                    <p className="font-bold text-slate-800">{lawyer.attendance_rate ?? '—'}%</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-400">إجمالي القضايا</p>
                    <p className="font-bold text-slate-800">{lawyer.total_cases ?? assigned}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-400">التواصل</p>
                    <p className="truncate font-bold text-slate-800">{lawyer.phone || lawyer.email}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {lawyers.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-slate-400">لا يوجد محامون مسجلون.</p>
          )}
        </div>
      )}

      {tab === 'permissions' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm lg:col-span-1">
            <h3 className="font-black text-slate-900">الأدوار</h3>
            {rolesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-[#7A1F2B]" />
              </div>
            ) : (
              <ul className="mt-3 space-y-1">
                {firmRoles.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => selectRole(r.id)}
                      className={`w-full rounded-xl px-3 py-2.5 text-right text-xs font-bold transition-colors ${
                        selectedRoleId === r.id ? 'bg-[#7A1F2B] text-white' : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {r.name}
                      {r.isTemplate && <span className="mr-2 text-[10px] opacity-70">(قالب)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 border-t border-slate-100 pt-4">
              <h4 className="text-xs font-black text-slate-700">دور مخصص جديد</h4>
              <input
                type="text"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="اسم الدور"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none"
              />
              <input
                type="text"
                value={newRoleSlug}
                onChange={(e) => setNewRoleSlug(e.target.value)}
                placeholder="المعرّف (مثل: senior_lawyer)"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none font-mono"
              />
              <button
                type="button"
                disabled={creatingRole}
                onClick={() => void handleCreateRole()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {creatingRole ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                إنشاء دور
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
            {!selectedRoleId ? (
              <p className="py-16 text-center text-sm text-slate-400">اختر دوراً لتعديل صلاحياته.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-black text-slate-900">مصفوفة الصلاحيات</h3>
                  <button
                    type="button"
                    disabled={savingRoleId === selectedRoleId}
                    onClick={() => void saveRolePermissions()}
                    className="flex items-center gap-2 rounded-xl bg-[#7A1F2B] px-4 py-2 text-xs font-bold text-white hover:bg-[#641923] disabled:opacity-60"
                  >
                    {savingRoleId === selectedRoleId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    حفظ
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PERMISSION_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(draftPermissions[key])}
                        onChange={() => togglePermission(key)}
                        className="h-4 w-4 rounded border-slate-300 text-[#7A1F2B] focus:ring-[#7A1F2B]"
                      />
                      <span className="text-xs font-bold text-slate-700">{PERMISSION_LABELS[key]}</span>
                      <span className="mr-auto font-mono text-[9px] text-slate-400">{key}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import type { PermissionKey } from '../types/app';
import { PERMISSION_LABELS } from '../lib/permissions';

/** Arabic group headings for the permissions matrix */
export const PERMISSION_GROUPS: Array<{ title: string; keys: PermissionKey[] }> = [
  {
    title: 'القضايا',
    keys: ['cases.view', 'cases.create', 'cases.edit', 'cases.delete']
  },
  {
    title: 'العملاء',
    keys: ['clients.view', 'clients.create', 'clients.edit', 'clients.delete']
  },
  {
    title: 'المستندات',
    keys: ['documents.upload', 'documents.download', 'documents.delete']
  },
  {
    title: 'المالية',
    keys: ['financials.view', 'financials.add_payments', 'financials.print_receipts']
  },
  {
    title: 'الجلسات',
    keys: ['sessions.view', 'sessions.create', 'sessions.edit']
  },
  {
    title: 'الموظفون والصلاحيات',
    keys: ['users.invite', 'users.manage', 'users.permissions']
  },
  {
    title: 'الاشتراك والإعدادات',
    keys: ['subscriptions.view', 'subscriptions.manage', 'settings.view', 'settings.edit']
  }
];

interface PermissionMatrixProps {
  permissions: Record<string, boolean>;
  onToggle: (key: PermissionKey) => void;
  disabled?: boolean;
  readOnlyKeys?: PermissionKey[];
}

export function PermissionMatrix({
  permissions,
  onToggle,
  disabled = false,
  readOnlyKeys = []
}: PermissionMatrixProps) {
  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.title}>
          <h4 className="mb-2 text-[11px] font-black text-slate-500">{group.title}</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.keys.map((key) => {
              const locked = readOnlyKeys.includes(key);
              return (
                <label
                  key={key}
                  className={`flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 ${
                    disabled || locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(permissions[key])}
                    disabled={disabled || locked}
                    onChange={() => onToggle(key)}
                    className="h-4 w-4 rounded border-slate-300 text-[#7A1F2B] focus:ring-[#7A1F2B]"
                  />
                  <span className="text-xs font-bold text-slate-700">{PERMISSION_LABELS[key]}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

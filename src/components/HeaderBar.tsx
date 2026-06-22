import { memo, useMemo } from 'react';
import {
  Archive,
  BarChart3,
  Bell,
  Briefcase,
  Calendar,
  CreditCard,
  FileText,
  Gavel,
  LogOut,
  Menu,
  Settings,
  Shield,
  TrendingUp,
  User,
  Users,
  X
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { FirmCodeCard } from './FirmCodeCard';
import { NotificationPanel } from './NotificationPanel';
import { UserAvatar } from './ui/UserAvatar';
import type { NotificationItem, PageId, SessionItem, User as UserType, UserRole } from '../types/app';
import { canAccessPage } from '../lib/permissions';
import { isFirmManagerRole } from '../lib/roleAccess';
import { resolveRoleDisplayName } from '../lib/roleLabels';

interface HeaderBarProps {
  user: UserType;
  currentPage: PageId;
  role: UserRole;
  permissions?: Record<string, boolean>;
  onChangePage: (page: PageId) => void;
  notificationCount: number;
  notifications: NotificationItem[];
  upcomingSessions: SessionItem[];
  sessionsLoading?: boolean;
  showNotificationDropdown: boolean;
  showUserDropdown: boolean;
  isMobileMenuOpen: boolean;
  setShowNotificationDropdown: (value: boolean) => void;
  setShowUserDropdown: (value: boolean) => void;
  setIsMobileMenuOpen: (value: boolean) => void;
  markAllNotificationsRead: () => void;
  markNotificationRead: (id: string) => void;
  handleLogout: () => void;
  firmCode?: string;
  firmName?: string;
  onFirmCodeCopied?: (message: string) => void;
  isSuperAdmin?: boolean;
  isBillingAdmin?: boolean;
}

const navItems: Array<{ id: PageId; label: string; shortLabel?: string; icon: typeof Briefcase }> = [
  { id: 'dashboard', label: 'الرئيسية', shortLabel: 'الرئيسية', icon: BarChart3 },
  { id: 'clients', label: 'العملاء', icon: Users },
  { id: 'execution', label: 'طلبات التنفيذ', shortLabel: 'تنفيذ', icon: Gavel },
  { id: 'cases', label: 'القضايا', icon: Briefcase },
  { id: 'archive', label: 'الأرشيف', icon: Archive },
  { id: 'employees', label: 'الموظفون', shortLabel: 'موظفون', icon: User },
  { id: 'sessions', label: 'الجلسات', icon: Calendar },
  { id: 'documents', label: 'المستندات', shortLabel: 'مستندات', icon: FileText },
  { id: 'lawyers', label: 'المحامون', shortLabel: 'محامون', icon: Shield },
  { id: 'reports', label: 'التقارير المالية', shortLabel: 'تقارير', icon: TrendingUp }
];

export const HeaderBar = memo(function HeaderBar({
  user,
  currentPage,
  role,
  permissions,
  onChangePage,
  notificationCount: _notificationCount,
  notifications,
  upcomingSessions,
  sessionsLoading = false,
  showNotificationDropdown,
  showUserDropdown,
  isMobileMenuOpen,
  setShowNotificationDropdown,
  setShowUserDropdown,
  setIsMobileMenuOpen,
  markAllNotificationsRead,
  markNotificationRead,
  handleLogout,
  firmCode,
  firmName,
  onFirmCodeCopied,
  isSuperAdmin: _isSuperAdmin = false,
  isBillingAdmin = false
}: HeaderBarProps) {
  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);
  const alertCount = useMemo(
    () => unreadCount + upcomingSessions.length,
    [unreadCount, upcomingSessions.length]
  );
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => canAccessPage(permissions, item.id, role)),
    [permissions, role]
  );
  const officeLabel = firmName?.trim() || user.company?.trim() || 'مكتب محاماة';
  const roleLabel = user.roleLabel ?? resolveRoleDisplayName(undefined, undefined, role);

  return (
    <header
      className="app-header sticky top-0 z-40 w-full border-b border-white/10 bg-[#7A1F2B] text-white shadow-lg shadow-black/10"
      dir="rtl"
    >
      <div className="mx-auto grid h-16 w-full max-w-[1440px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:h-[72px] lg:gap-4 lg:px-6 xl:px-8">
        {/* الشعار */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className="transition-opacity hover:opacity-90"
            onClick={() => onChangePage('dashboard')}
            aria-label="الرئيسية"
          >
            <AppLogo variant="law" size="sm" tone="inverted" />
          </button>
        </div>

        {/* القائمة — مضغوطة لتظهر كل الصفحات */}
        <nav className="hidden min-w-0 lg:block" aria-label="القائمة الرئيسية">
          <div className="flex items-center justify-center gap-0.5 overflow-x-auto py-0.5 scrollbar-none lg:gap-1 xl:gap-1.5">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  onClick={() => {
                    onChangePage(item.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`app-header-nav-btn flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-bold leading-none transition-colors lg:px-2 lg:py-1.5 lg:text-[11px] xl:gap-1.5 xl:rounded-lg xl:px-2.5 xl:py-2 xl:text-xs 2xl:gap-2 2xl:px-3 2xl:text-sm ${
                    isActive ? 'bg-[#A33A49] text-white shadow-sm' : 'text-white hover:bg-[#641923]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4" />
                  <span className="whitespace-nowrap xl:hidden">{item.shortLabel ?? item.label}</span>
                  <span className="hidden whitespace-nowrap xl:inline">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* أدوات المستخدم */}
        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
          {firmCode ? (
            <div className="hidden 2xl:block">
              <FirmCodeCard variant="navbar" firmCode={firmCode} onCopied={onFirmCodeCopied} />
            </div>
          ) : null}

          {isFirmManagerRole(role) ? (
            <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-[#641923] px-2 py-0.5 xl:flex">
              <span className="text-[9px] font-semibold text-white/80">الصلاحية:</span>
              <span className="max-w-[4.5rem] truncate text-[9px] font-bold text-white 2xl:max-w-none">{roleLabel}</span>
            </div>
          ) : null}

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}
              className="rounded-xl p-2 text-white transition-colors hover:bg-[#641923]"
              aria-label="التنبيهات"
            >
              <Bell className="h-5 w-5" />
              {alertCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[#DC2626] ring-2 ring-[#7A1F2B]" />
              )}
            </button>

            {showNotificationDropdown && (
              <NotificationPanel
                notifications={notifications}
                upcomingSessions={upcomingSessions}
                sessionsLoading={sessionsLoading}
                onNavigate={onChangePage}
                onClose={() => setShowNotificationDropdown(false)}
                markAllNotificationsRead={markAllNotificationsRead}
                markNotificationRead={markNotificationRead}
              />
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              className="flex items-center gap-1.5 rounded-lg p-1 text-right transition-colors hover:bg-[#641923] sm:p-1.5 xl:gap-2"
            >
              <UserAvatar name={user.name} imageUrl={user.image} size="sm" />
              <div className="hidden min-w-0 xl:block">
                <p className="max-w-20 truncate text-[11px] font-bold leading-tight text-white 2xl:max-w-28">{user.name}</p>
                <p className="mt-0.5 max-w-24 truncate text-[9px] text-white/70 2xl:max-w-32" title={officeLabel}>
                  {officeLabel}
                </p>
              </div>
            </button>

            {showUserDropdown && (
              <div className="absolute left-0 z-50 mt-2 w-56 rounded-xl border border-slate-100 bg-white py-2 text-slate-900 shadow-xl">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-right">
                  <p className="text-xs font-bold text-slate-800">{user.name}</p>
                  <p className="mt-0.5 text-[10px] font-bold text-indigo-700">{officeLabel}</p>
                  <p className="mt-0.5 break-all text-[10px] text-slate-500">{user.email}</p>
                  {firmCode ? (
                    <div className="mt-3 border-t border-slate-200 pt-3">
                      <p className="mb-1.5 text-[10px] font-bold text-slate-500">كود المكتب</p>
                      <FirmCodeCard variant="compact" firmCode={firmCode} onCopied={onFirmCodeCopied} />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChangePage('profile');
                    setShowUserDropdown(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-right text-xs text-slate-700 hover:bg-indigo-50"
                >
                  <User className="h-4 w-4 text-slate-400" />
                  <span>الملف الشخصي {user.image ? '' : '— أضف صورتك'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangePage('subscription');
                    setShowUserDropdown(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-right text-xs text-slate-700 hover:bg-indigo-50"
                >
                  <CreditCard className="h-4 w-4 text-slate-400" />
                  <span>الباقة والفوترة</span>
                </button>
                {isBillingAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChangePage('admin-billing');
                      setShowUserDropdown(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-right text-xs text-[#7A1F2B] hover:bg-[#FFF9FA] font-bold"
                  >
                    <CreditCard className="h-4 w-4 text-amber-300" />
                    <span>قبول الاشتراكات</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    onChangePage('settings');
                    setShowUserDropdown(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-right text-xs text-slate-700 hover:bg-indigo-50"
                >
                  <Settings className="h-4 w-4 text-slate-400" />
                  <span>الإعدادات</span>
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2 text-right text-xs font-bold text-rose-600 hover:bg-rose-50"
                >
                  <LogOut className="h-4 w-4" />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="rounded-xl p-2.5 text-white transition-colors hover:bg-[#641923] lg:hidden"
            aria-label="القائمة"
          >
            {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="border-t border-white/10 bg-[#7A1F2B] px-4 py-3 lg:hidden sm:px-6">
          {firmCode ? (
            <div className="mb-3 rounded-xl border border-white/15 bg-[#641923] p-3" dir="rtl">
              <p className="mb-2 text-[10px] font-bold text-amber-200">كود المكتب — للمشاركة مع الفريق</p>
              <FirmCodeCard variant="compact" firmCode={firmCode} onCopied={onFirmCodeCopied} />
            </div>
          ) : null}
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChangePage(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-white ${
                  currentPage === item.id ? 'bg-[#A33A49]' : 'hover:bg-[#641923]'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
});

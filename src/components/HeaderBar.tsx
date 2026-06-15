import { useMemo } from 'react';
import {
  Archive,
  BarChart3,
  Bell,
  Briefcase,
  Calendar,
  CreditCard,
  FileText,
  LogOut,
  Menu,
  Settings,
  Shield,
  ShieldCheck,
  TrendingUp,
  User,
  Users,
  X
} from 'lucide-react';
import { FirmCodeCard } from './FirmCodeCard';
import type { NotificationItem, PageId, User as UserType, UserRole } from '../types/app';

interface HeaderBarProps {
  user: UserType;
  currentPage: PageId;
  role: UserRole;
  onChangePage: (page: PageId) => void;
  notificationCount: number;
  notifications: NotificationItem[];
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
  onFirmCodeCopied?: (message: string) => void;
}

const navItems: Array<{ id: PageId; label: string; icon: typeof Briefcase; roles: UserRole[] }> = [
  { id: 'dashboard', label: 'الرئيسية', icon: BarChart3, roles: ['super_admin', 'admin', 'firm_manager', 'lawyer', 'assistant'] },
  { id: 'clients', label: 'العملاء', icon: Users, roles: ['super_admin', 'admin', 'firm_manager', 'assistant'] },
  { id: 'cases', label: 'القضايا', icon: Briefcase, roles: ['super_admin', 'admin', 'firm_manager', 'lawyer', 'assistant'] },
  { id: 'archive', label: 'الأرشيف', icon: Archive, roles: ['super_admin', 'admin', 'firm_manager'] },
  { id: 'employees', label: 'الموظفون', icon: User, roles: ['super_admin', 'admin', 'firm_manager'] },
  { id: 'sessions', label: 'الجلسات', icon: Calendar, roles: ['super_admin', 'admin', 'firm_manager', 'lawyer', 'assistant'] },
  { id: 'documents', label: 'المستندات', icon: FileText, roles: ['super_admin', 'admin', 'firm_manager', 'lawyer', 'assistant'] },
  { id: 'lawyers', label: 'المحامون', icon: Shield, roles: ['super_admin', 'admin', 'firm_manager', 'assistant'] },
  { id: 'reports', label: 'التقارير المالية', icon: TrendingUp, roles: ['super_admin', 'admin', 'firm_manager'] }
];

export function HeaderBar({
  user,
  currentPage,
  role,
  onChangePage,
  notificationCount: _notificationCount,
  notifications,
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
  onFirmCodeCopied
}: HeaderBarProps) {
  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);
  const visibleNavItems = useMemo(() => navItems.filter((item) => item.roles.includes(role)), [role]);

  return (
    <header className="sticky top-0 z-40 bg-[#7A1F2B] !text-white shadow-lg shadow-black/10 border-b border-white/10" dir="rtl">
      <div className="w-full max-w-[1440px] mx-auto px-5 pl-5 pr-8 sm:px-8 sm:pl-8 sm:pr-12 lg:px-10 lg:pl-10 lg:pr-14 xl:pr-16 h-[72px] flex items-center justify-between gap-4 sm:gap-5">
        <div className="flex items-center gap-3 cursor-pointer shrink-0 pr-4 sm:pr-6" onClick={() => onChangePage('dashboard')}>
          <div className="bg-white p-2.5 rounded-xl text-[#7A1F2B] shadow-sm">
            <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div className="leading-tight">
            <span className="font-extrabold text-lg tracking-tight block !text-white">LegalMind</span>
            <span className="text-[11px] !text-white block mt-0.5 font-semibold">نظام إدارة مكاتب المحاماة</span>
          </div>
        </div>

        <nav className="hidden lg:flex items-center justify-center gap-2 flex-1 px-4 lg:px-6 min-w-0">
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
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors whitespace-nowrap !text-white ${
                  currentPage === item.id
                    ? 'bg-[#A33A49] shadow-sm'
                    : 'hover:bg-[#641923]'
                }`}
              >
                <Icon className="w-4.5 h-4.5 !text-white" />
                <span className="!text-white">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 me-1 sm:me-2">
          {firmCode ? (
            <FirmCodeCard variant="navbar" firmCode={firmCode} onCopied={onFirmCodeCopied} />
          ) : null}

          <div className="hidden md:flex items-center gap-2 bg-[#641923] px-3 py-1.5 rounded-full text-xs border border-white/10">
            <span className="font-semibold text-[10px] !text-white">الصلاحية:</span>
            <span className="!text-white font-bold">{role}</span>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}
              className="p-2.5 !text-white hover:bg-[#641923] rounded-xl relative transition-all"
            >
              <Bell className="w-5 h-5 !text-white" />
              {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#DC2626] rounded-full ring-2 ring-[#7A1F2B] animate-pulse" />}
            </button>

            {showNotificationDropdown && (
              <div className="absolute left-0 mt-2 w-80 bg-white text-slate-900 rounded-xl shadow-xl py-2 z-50 border border-slate-100">
                <div className="px-4 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <span className="font-bold text-xs text-slate-700">تنبيهات النظام الذكية</span>
                  <button
                    type="button"
                    onClick={markAllNotificationsRead}
                    className="text-[11px] text-indigo-700 hover:underline font-bold"
                  >
                    تعيين الكل كمقروء
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {notifications.map((notif) => (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => {
                        markNotificationRead(notif.id);
                        onChangePage('notifications');
                        setShowNotificationDropdown(false);
                      }}
                      className={`w-full text-right p-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${notif.read ? '' : 'bg-amber-50/40'}`}
                    >
                      <div className="flex justify-between items-start gap-1">
                        <span className="font-bold text-xs text-slate-800">{notif.title}</span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{notif.time}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{notif.message}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              className="flex items-center gap-2.5 p-1.5 hover:bg-[#641923] rounded-xl transition-colors text-right"
            >
              <div className="w-9 h-9 rounded-full bg-white text-[#7A1F2B] flex items-center justify-center font-bold text-xs border border-white/30 shadow-sm">
                {user.name.substring(3, 5)}
              </div>
              <div className="hidden md:block min-w-0">
                <p className="text-xs font-bold leading-tight !text-white max-w-28 truncate">{user.name}</p>
                <p className="text-[10px] !text-white font-sans mt-0.5">مكتب معتمد</p>
              </div>
            </button>

            {showUserDropdown && (
              <div className="absolute left-0 mt-2 w-56 bg-white text-slate-900 rounded-xl shadow-xl py-2 z-50 border border-slate-100">
                <div className="px-4 py-3 border-b border-slate-100 text-right bg-slate-50">
                  <p className="text-xs font-bold text-slate-800">{user.name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 break-all">{user.email}</p>
                  {firmCode ? (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <p className="text-[10px] font-bold text-slate-500 mb-1.5">كود المكتب</p>
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
                  className="w-full text-right px-4 py-2 text-xs text-slate-700 hover:bg-indigo-50 flex items-center gap-2"
                >
                  <User className="w-4 h-4 text-slate-400" />
                  <span>الملف الشخصي</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangePage('subscription');
                    setShowUserDropdown(false);
                  }}
                  className="w-full text-right px-4 py-2 text-xs text-slate-700 hover:bg-indigo-50 flex items-center gap-2"
                >
                  <CreditCard className="w-4 h-4 text-slate-400" />
                  <span>الباقة والفوترة</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangePage('settings');
                    setShowUserDropdown(false);
                  }}
                  className="w-full text-right px-4 py-2 text-xs text-slate-700 hover:bg-indigo-50 flex items-center gap-2"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  <span>الإعدادات</span>
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-right px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-bold"
                >
                  <LogOut className="w-4 h-4" />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden p-2.5 !text-white hover:bg-[#641923] rounded-xl transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="lg:hidden bg-[#7A1F2B] border-t border-white/10 px-5 pl-5 pr-8 sm:px-8 sm:pl-8 sm:pr-12 py-3 space-y-1">
          {firmCode ? (
            <div className="mb-3 rounded-xl border border-white/15 bg-[#641923] p-3" dir="rtl">
              <p className="text-[10px] font-bold text-amber-200 mb-2">كود المكتب — للمشاركة مع الفريق</p>
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
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold !text-white ${
                  currentPage === item.id ? 'bg-[#A33A49]' : 'hover:bg-[#641923]'
                }`}
              >
                <Icon className="w-5 h-5 !text-white" />
                <span className="!text-white">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}

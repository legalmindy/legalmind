import { useMemo } from 'react';
import {
  Archive,
  BarChart3,
  Bell,
  Briefcase,
  Calendar,
  CreditCard,
  FileText,
  Lock,
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
import type { NotificationItem, PageId, User as UserType, UserRole } from '../types/app';

interface HeaderBarProps {
  user: UserType;
  currentPage: PageId;
  role: UserRole;
  onChangePage: (page: PageId) => void;
  onRoleChange: (value: UserRole) => void;
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
}

const navItems: Array<{ id: PageId; label: string; icon: typeof Briefcase }> = [
  { id: 'dashboard', label: 'الرئيسية', icon: BarChart3 },
  { id: 'clients', label: 'العملاء', icon: Users },
  { id: 'cases', label: 'القضايا', icon: Briefcase },
  { id: 'archive', label: 'الأرشيف', icon: Archive },
  { id: 'employees', label: 'الموظفون', icon: User },
  { id: 'sessions', label: 'الجلسات', icon: Calendar },
  { id: 'documents', label: 'المستندات', icon: FileText },
  { id: 'lawyers', label: 'المحامون', icon: Shield },
  { id: 'reports', label: 'التقارير المالية', icon: TrendingUp }
];

export function HeaderBar({
  user,
  currentPage,
  role,
  onChangePage,
  onRoleChange,
  notificationCount,
  notifications,
  showNotificationDropdown,
  showUserDropdown,
  isMobileMenuOpen,
  setShowNotificationDropdown,
  setShowUserDropdown,
  setIsMobileMenuOpen,
  markAllNotificationsRead,
  markNotificationRead,
  handleLogout
}: HeaderBarProps) {
  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  return (
    <header className="sticky top-0 z-40 bg-indigo-950 text-white shadow-md border-b border-indigo-900/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => onChangePage('dashboard')}>
          <div className="bg-amber-500 p-2 rounded-lg text-indigo-950">
            <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <span className="font-extrabold text-xl tracking-tight block">LegalMind <span className="text-amber-400">Yemen</span></span>
            <span className="text-[10px] text-indigo-300 block -mt-1 font-mono">نظام إدارة مكاتب المحاماة اليمنية</span>
          </div>
        </div>

        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChangePage(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentPage === item.id
                    ? 'bg-amber-500 text-slate-900 shadow-sm font-bold'
                    : 'hover:bg-indigo-900 text-slate-200'
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 bg-indigo-900 px-2.5 py-1 rounded-full text-xs text-indigo-200">
            <span className="font-semibold text-[10px] text-amber-400">الصلاحية الحالية:</span>
            <select
              value={role}
              onChange={(e) => onRoleChange(e.target.value as UserRole)}
              className="bg-transparent text-indigo-200 outline-none cursor-pointer text-xs font-bold border-none"
            >
              <option className="bg-indigo-950 text-white" value="super_admin">سوبر أدمن</option>
              <option className="bg-indigo-950 text-white" value="admin">أدمن</option>
              <option className="bg-indigo-950 text-white" value="firm_manager">مدير مكتب</option>
              <option className="bg-indigo-950 text-white" value="lawyer">محامٍ</option>
              <option className="bg-indigo-950 text-white" value="assistant">مساعد</option>
            </select>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}
              className="p-2 text-indigo-200 hover:text-white hover:bg-indigo-900 rounded-lg relative transition-all"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full ring-2 ring-indigo-950 animate-pulse" />}
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
              className="flex items-center gap-2 p-1 hover:bg-indigo-900 rounded-lg transition-colors text-right"
            >
              <div className="w-8 h-8 rounded-full bg-amber-500 text-indigo-950 flex items-center justify-center font-bold text-xs border border-amber-300">
                {user.name.substring(3, 5)}
              </div>
              <div className="hidden md:block">
                <p className="text-xs font-bold leading-tight">{user.name}</p>
                <p className="text-[9px] text-indigo-300 font-sans">مكتب معتمد</p>
              </div>
            </button>

            {showUserDropdown && (
              <div className="absolute left-0 mt-2 w-56 bg-white text-slate-900 rounded-xl shadow-xl py-2 z-50 border border-slate-100">
                <div className="px-4 py-3 border-b border-slate-100 text-right bg-slate-50">
                  <p className="text-xs font-bold text-slate-800">{user.name}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5 break-all">{user.email}</p>
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
            className="lg:hidden p-2 text-indigo-200 hover:text-white rounded-lg transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="lg:hidden bg-indigo-900 border-t border-indigo-800 px-4 py-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChangePage(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                  currentPage === item.id ? 'bg-amber-500 text-slate-950 font-bold' : 'text-indigo-100 hover:bg-indigo-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}

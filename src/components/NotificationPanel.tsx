import { Calendar, Clock } from 'lucide-react';
import type { NotificationItem, PageId, SessionItem } from '../types/app';
import {
  formatSessionWhen,
  getSessionUrgency,
  sessionAlertTitle
} from '../lib/sessionAlerts';

interface NotificationPanelProps {
  notifications: NotificationItem[];
  upcomingSessions: SessionItem[];
  sessionsLoading?: boolean;
  onNavigate: (page: PageId) => void;
  onClose: () => void;
  markAllNotificationsRead: () => void;
  markNotificationRead: (id: string) => void;
}

function urgencyClasses(urgency: ReturnType<typeof getSessionUrgency>): string {
  if (urgency === 'today') return 'bg-rose-50 border-rose-100 text-rose-800';
  if (urgency === 'tomorrow') return 'bg-amber-50 border-amber-100 text-amber-900';
  return 'bg-sky-50 border-sky-100 text-sky-900';
}

export function NotificationPanel({
  notifications,
  upcomingSessions,
  sessionsLoading = false,
  onNavigate,
  onClose,
  markAllNotificationsRead,
  markNotificationRead
}: NotificationPanelProps) {
  const unreadNotifications = notifications.filter((item) => !item.read).length;
  const totalAlerts = unreadNotifications + upcomingSessions.length;

  return (
    <div className="absolute left-0 z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-slate-100 bg-white py-2 text-slate-900 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2">
        <span className="text-xs font-bold text-slate-700">
          التنبيهات {totalAlerts > 0 ? `(${totalAlerts})` : ''}
        </span>
        {unreadNotifications > 0 ? (
          <button
            type="button"
            onClick={markAllNotificationsRead}
            className="text-[11px] font-bold text-indigo-700 hover:underline"
          >
            تعيين الكل كمقروء
          </button>
        ) : null}
      </div>

      <div className="max-h-80 overflow-y-auto">
        <div className="border-b border-slate-100 px-4 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-black text-slate-700">الجلسات القادمة</span>
            <button
              type="button"
              onClick={() => {
                onNavigate('sessions');
                onClose();
              }}
              className="text-[10px] font-bold text-indigo-700 hover:underline"
            >
              كل الجلسات
            </button>
          </div>

          {sessionsLoading ? (
            <p className="py-3 text-center text-[11px] text-slate-400">جاري تحميل الجلسات…</p>
          ) : upcomingSessions.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-slate-400">لا توجد جلسات مجدولة قريباً.</p>
          ) : (
            upcomingSessions.map((session) => {
              const urgency = getSessionUrgency(session);
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    onNavigate('sessions');
                    onClose();
                  }}
                  className={`mb-2 w-full rounded-xl border p-3 text-right transition-colors hover:opacity-90 ${urgencyClasses(urgency)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-black">{sessionAlertTitle(session)}</span>
                    <Calendar className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  </div>
                  <p className="mt-1 text-[11px] font-bold leading-snug">{session.caseTitle}</p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] opacity-80">
                    <Clock className="h-3 w-3" />
                    {formatSessionWhen(session)}
                    {session.court ? ` • ${session.court}` : ''}
                  </p>
                </button>
              );
            })
          )}
        </div>

        {notifications.length > 0 ? (
          <div className="px-1 py-1">
            <p className="px-3 py-1 text-[11px] font-black text-slate-700">إشعارات النظام</p>
            {notifications.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => {
                  markNotificationRead(notif.id);
                  onClose();
                }}
                className={`w-full border-b border-slate-50 p-3 text-right transition-colors hover:bg-slate-50 ${notif.read ? '' : 'bg-amber-50/40'}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-xs font-bold text-slate-800">{notif.title}</span>
                  <span className="whitespace-nowrap text-[10px] text-slate-400">{notif.time}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-600">{notif.message}</p>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

import type { SessionItem } from '../types/app';

export type SessionUrgency = 'today' | 'tomorrow' | 'upcoming';

const REMINDER_STORAGE_KEY = 'legalmind_session_reminders_v1';

function parseSessionDateTime(session: SessionItem): Date | null {
  if (!session.date) return null;
  const time = session.time?.trim() || '09:00';
  const parsed = new Date(`${session.date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfLocalDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getSessionUrgency(session: SessionItem, now = new Date()): SessionUrgency | null {
  if (session.status !== 'مجدولة') return null;
  if (!session.date) return null;

  const sessionDay = startOfLocalDay(new Date(`${session.date}T12:00:00`));
  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (sessionDay.getTime() === today.getTime()) return 'today';
  if (sessionDay.getTime() === tomorrow.getTime()) return 'tomorrow';
  if (sessionDay.getTime() > tomorrow.getTime()) return 'upcoming';
  return null;
}

export function isUpcomingScheduledSession(session: SessionItem, now = new Date()): boolean {
  const when = parseSessionDateTime(session);
  if (!when || session.status !== 'مجدولة') return false;
  return when.getTime() >= startOfLocalDay(now).getTime();
}

export function formatSessionWhen(session: SessionItem): string {
  const urgency = getSessionUrgency(session);
  const timeLabel = session.time ? session.time.slice(0, 5) : '';
  if (urgency === 'today') return timeLabel ? `اليوم ${timeLabel}` : 'اليوم';
  if (urgency === 'tomorrow') return timeLabel ? `غداً ${timeLabel}` : 'غداً';
  return [session.date, timeLabel].filter(Boolean).join(' • ');
}

export function sessionAlertTitle(session: SessionItem): string {
  const urgency = getSessionUrgency(session);
  if (urgency === 'today') return 'جلسة اليوم';
  if (urgency === 'tomorrow') return 'جلسة غداً';
  return 'جلسة قادمة';
}

export function sessionAlertMessage(session: SessionItem): string {
  const when = formatSessionWhen(session);
  const court = session.court ? ` — ${session.court}` : '';
  return `${session.caseTitle}${court} (${when})`;
}

function readReminderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeReminderIds(ids: Set<string>): void {
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify([...ids].slice(-100)));
  } catch {
    /* ignore quota */
  }
}

export function shouldShowSessionReminder(session: SessionItem, now = new Date()): boolean {
  const urgency = getSessionUrgency(session, now);
  if (!urgency || urgency === 'upcoming') return false;
  const reminderKey = `${session.id}:${session.date}`;
  const seen = readReminderIds();
  return !seen.has(reminderKey);
}

export function markSessionReminderShown(session: SessionItem): void {
  const reminderKey = `${session.id}:${session.date}`;
  const seen = readReminderIds();
  seen.add(reminderKey);
  writeReminderIds(seen);
}

export function sortSessionsByDateTime(sessions: SessionItem[]): SessionItem[] {
  return [...sessions].sort((a, b) => {
    const aDate = parseSessionDateTime(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDate = parseSessionDateTime(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
}

export function filterUpcomingSessions(sessions: SessionItem[], limit = 8, now = new Date()): SessionItem[] {
  return sortSessionsByDateTime(sessions.filter((session) => isUpcomingScheduledSession(session, now))).slice(
    0,
    limit
  );
}

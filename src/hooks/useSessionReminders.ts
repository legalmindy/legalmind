import { useEffect, useRef } from 'react';
import type { SessionItem } from '../types/app';
import {
  markSessionReminderShown,
  sessionAlertMessage,
  sessionAlertTitle,
  shouldShowSessionReminder
} from '../lib/sessionAlerts';

type AlertFn = (message: string, type?: 'info' | 'success' | 'error') => void;

export function useSessionReminders(
  sessions: SessionItem[] | undefined,
  enabled: boolean,
  showAlert: AlertFn
): void {
  const shownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !sessions?.length) return;

    for (const session of sessions) {
      if (!shouldShowSessionReminder(session)) continue;
      const reminderKey = `${session.id}:${session.date}`;
      if (shownRef.current.has(reminderKey)) continue;

      shownRef.current.add(reminderKey);
      markSessionReminderShown(session);
      showAlert(`${sessionAlertTitle(session)}: ${sessionAlertMessage(session)}`, 'info');

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(sessionAlertTitle(session), {
            body: sessionAlertMessage(session),
            tag: reminderKey
          });
        } catch {
          /* ignore unsupported environments */
        }
      }
    }
  }, [enabled, sessions, showAlert]);
}

export function useNotificationPermission(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    void Notification.requestPermission().catch(() => undefined);
  }, [enabled]);
}

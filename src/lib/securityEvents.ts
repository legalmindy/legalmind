import { supabase, callPublicRpc } from './supabaseClient';

export type SecurityEventType =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'session_expired'
  | 'mfa_required'
  | 'mfa_success'
  | 'permission_denied'
  | 'registration_attempt'
  | 'password_reset_request';

export type SecuritySeverity = 'info' | 'warning' | 'high' | 'critical';

function userAgent(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.userAgent.slice(0, 500);
}

/** Fire-and-forget security audit log (never throws to caller). */
export function logSecurityEvent(
  eventType: SecurityEventType,
  severity: SecuritySeverity = 'info',
  metadata: Record<string, unknown> = {}
): void {
  void supabase
    .rpc('log_security_event', {
      p_event_type: eventType,
      p_severity: severity,
      p_metadata: metadata,
      p_user_agent: userAgent() ?? null
    })
    .then(({ error }) => {
      if (error && import.meta.env.DEV) {
        console.warn('[SECURITY] log_security_event:', error.message);
      }
    });
}

export interface SecurityEventRow {
  id: string;
  event_type: string;
  severity: string;
  user_agent?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** Pre-auth events (failed login, registration) — no session attached. */
export function logSecurityEventPublic(
  eventType: SecurityEventType,
  severity: SecuritySeverity = 'info',
  metadata: Record<string, unknown> = {}
): void {
  void callPublicRpc('log_security_event', {
    p_event_type: eventType,
    p_severity: severity,
    p_metadata: metadata,
    p_user_agent: userAgent() ?? null
  }).then(({ error }) => {
    if (error && import.meta.env.DEV) {
      console.warn('[SECURITY] log_security_event:', error.message);
    }
  });
}

export async function fetchSecurityEvents(limit = 100): Promise<SecurityEventRow[]> {
  const { data, error } = await supabase.rpc('list_firm_security_events', { p_limit: limit });
  if (error) {
    if (/401|403|not_authorized|JWT/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []) as SecurityEventRow[];
}

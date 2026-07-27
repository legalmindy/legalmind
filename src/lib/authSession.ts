import { supabase } from './supabaseClient';

export function isInvalidAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code ?? '')
      : '';

  // Match auth/session failures only — bare "invalid" matches Postgres enum errors
  // and would incorrectly sign the user out mid-flow.
  return (
    /PGRST301|JWT|refresh.?token|not authenticated|unauthorized|session.?expired|jwt expired|invalid.?jwt|invalid.?claim|invalid.?refresh/i.test(
      message
    ) ||
    /PGRST301|401|403|invalid_grant|bad_jwt/i.test(code) ||
    /\b401\b|\b403\b/.test(message)
  );
}

export async function signOutLocal(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' });
}

/** Validates JWT with Supabase; clears stale local session on 401/403. */
export async function resolveAuthUserId(): Promise<string | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    if (isInvalidAuthError(error)) {
      await signOutLocal();
    }
    return null;
  }

  if (!user) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await signOutLocal();
    }
    return null;
  }

  return user.id;
}

export async function purgeInvalidSession(onClear?: () => void): Promise<boolean> {
  const userId = await resolveAuthUserId();
  if (userId) return false;
  onClear?.();
  return true;
}

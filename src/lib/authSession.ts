import { supabase } from './supabaseClient';

export function isInvalidAuthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /401|403|jwt|invalid|expired|session|unauthorized|PGRST301/i.test(message);
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

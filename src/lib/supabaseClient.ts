import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Default: each browser tab has its own login. Set VITE_AUTH_SHARED_SESSION=true to share login across tabs. */
const useSessionStoragePerTab = import.meta.env.VITE_AUTH_SHARED_SESSION !== 'true';

function createAuthStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  return useSessionStoragePerTab ? window.sessionStorage : window.localStorage;
}

export const isSupabaseConfigured = (): boolean =>
  Boolean(supabaseUrl && supabaseAnonKey);

export const isAuthSessionPerTab = (): boolean => useSessionStoragePerTab;

const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storage: createAuthStorage(),
  storageKey: useSessionStoragePerTab ? 'legalmind-auth-tab' : 'legalmind-auth'
} as const;

function createSupabaseClient(): SupabaseClient {
  const fetchWithTimeout: typeof fetch = (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  if (!isSupabaseConfigured()) {
    if (import.meta.env.DEV) {
      console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    }
    return createClient('https://placeholder.supabase.co', 'placeholder', {
      auth: authOptions,
      global: { fetch: fetchWithTimeout }
    });
  }
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: authOptions,
    global: { fetch: fetchWithTimeout }
  });
}

export const supabase = createSupabaseClient();

/** Client without persisted session — for pre-login RPCs (avoids 401 from stale JWT). */
function createPublicSupabaseClient(): SupabaseClient {
  const fetchWithTimeout: typeof fetch = (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  if (!isSupabaseConfigured()) {
    return createClient('https://placeholder.supabase.co', 'placeholder', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchWithTimeout }
    });
  }

  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout }
  });
}

const publicSupabase = createPublicSupabaseClient();

export function callPublicRpc(fn: string, args: Record<string, unknown> = {}) {
  return publicSupabase.rpc(fn, args);
}

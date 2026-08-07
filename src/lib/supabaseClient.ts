import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PRODUCTION_SUPABASE_ANON_KEY, PRODUCTION_SUPABASE_URL } from './productionSupabase';

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Deleted / retired Supabase projects — never ship these hosts as the active backend. */
const RETIRED_SUPABASE_HOSTS = ['dlkxzjyvcmsgnovwmntd.supabase.co'] as const;

function isRetiredSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  return RETIRED_SUPABASE_HOSTS.some((host) => url.includes(host));
}

/**
 * Resolve the Supabase backend used by Web + Android.
 * Prefer valid VITE_* values; if missing or retired, hard-fallback to production
 * so Capacitor APKs never trap users behind a deleted project URL.
 */
function resolveSupabaseConfig(): { url: string; anonKey: string; usedFallback: boolean } {
  const envOk =
    Boolean(envSupabaseUrl && envSupabaseAnonKey) && !isRetiredSupabaseUrl(envSupabaseUrl);

  if (envOk) {
    return { url: envSupabaseUrl!, anonKey: envSupabaseAnonKey!, usedFallback: false };
  }

  return {
    url: PRODUCTION_SUPABASE_URL,
    anonKey: PRODUCTION_SUPABASE_ANON_KEY,
    usedFallback: true
  };
}

const resolved = resolveSupabaseConfig();
const supabaseUrl = resolved.url;
const supabaseAnonKey = resolved.anonKey;

if (import.meta.env.DEV && isRetiredSupabaseUrl(envSupabaseUrl)) {
  console.error(
    '[Supabase] VITE_SUPABASE_URL pointed at a deleted project. Using production fallback:',
    PRODUCTION_SUPABASE_URL
  );
} else if (import.meta.env.DEV && resolved.usedFallback && !envSupabaseUrl) {
  console.warn('[Supabase] VITE_SUPABASE_URL missing — using production fallback.');
}

/** Default: each browser tab has its own login. Set VITE_AUTH_SHARED_SESSION=true to share login across tabs. */
const useSessionStoragePerTab = import.meta.env.VITE_AUTH_SHARED_SESSION !== 'true';

function createAuthStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  return useSessionStoragePerTab ? window.sessionStorage : window.localStorage;
}

export const isSupabaseConfigured = (): boolean =>
  Boolean(supabaseUrl && supabaseAnonKey && !isRetiredSupabaseUrl(supabaseUrl));

/**
 * True only when env still targets a deleted project AND fallback somehow
 * did not recover (should be rare). Login UI must not block when fallback works.
 */
export const isRetiredSupabaseConfigured = (): boolean =>
  isRetiredSupabaseUrl(envSupabaseUrl) && isRetiredSupabaseUrl(supabaseUrl);

export const isAuthSessionPerTab = (): boolean => useSessionStoragePerTab;

const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storage: createAuthStorage(),
  storageKey: useSessionStoragePerTab ? 'legalmind-auth-tab' : 'legalmind-auth'
} as const;

/** Safe network diagnostics — never logs bodies/passwords/tokens. */
function describeRequest(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof Request !== 'undefined' && input instanceof Request
          ? input.url
          : String(input);
  try {
    const u = new URL(rawUrl);
    return { method, url: `${u.origin}${u.pathname}` };
  } catch {
    return { method, url: rawUrl.split('?')[0] ?? rawUrl };
  }
}

function createInstrumentedFetch(): typeof fetch {
  const fetchWithTimeout: typeof fetch = async (input, init) => {
    const controller = new AbortController();
    const outerSignal = init?.signal;
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort(outerSignal.reason);
      else outerSignal.addEventListener('abort', () => controller.abort(outerSignal.reason), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), 20_000);
    const meta = describeRequest(input, init);
    const started = Date.now();
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (!response.ok && (import.meta.env.DEV || import.meta.env.VITE_AUTH_DEBUG === 'true')) {
        console.warn('[supabase-fetch]', {
          ...meta,
          status: response.status,
          statusText: response.statusText,
          ms: Date.now() - started
        });
      }
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : 'Error';
      console.error('[supabase-fetch] network error', {
        ...meta,
        name,
        message,
        ms: Date.now() - started,
        online: typeof navigator !== 'undefined' ? navigator.onLine : undefined
      });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
  return fetchWithTimeout;
}

function createSupabaseClient(): SupabaseClient {
  const fetchWithTimeout = createInstrumentedFetch();

  if (!isSupabaseConfigured()) {
    if (import.meta.env.DEV) {
      console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    }
    return createClient('https://placeholder.supabase.co', 'placeholder', {
      auth: authOptions,
      global: { fetch: fetchWithTimeout }
    });
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: authOptions,
    global: { fetch: fetchWithTimeout }
  });
}

export const supabase = createSupabaseClient();

/** Client without persisted session — for pre-login RPCs (avoids 401 from stale JWT). */
function createPublicSupabaseClient(): SupabaseClient {
  const fetchWithTimeout = createInstrumentedFetch();

  if (!isSupabaseConfigured()) {
    return createClient('https://placeholder.supabase.co', 'placeholder', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchWithTimeout }
    });
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout }
  });
}

const publicSupabase = createPublicSupabaseClient();

export function callPublicRpc(fn: string, args: Record<string, unknown> = {}) {
  return publicSupabase.rpc(fn, args);
}

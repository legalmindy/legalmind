import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = (): boolean =>
  Boolean(supabaseUrl && supabaseAnonKey);

const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true
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

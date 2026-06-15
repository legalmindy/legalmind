import { supabase, isSupabaseConfigured } from './supabaseClient';

export interface ConnectionTestResult {
  success: boolean;
  configured: boolean;
  authenticated: boolean;
  syncRpcReady: boolean;
  tables: Record<string, boolean>;
  error?: string;
}

/** Lightweight connectivity check — no duplicate table spam. */
export async function testSupabaseConnection(): Promise<ConnectionTestResult> {
  const configured = isSupabaseConfigured();
  if (!configured) {
    return { success: false, configured: false, authenticated: false, syncRpcReady: false, tables: {}, error: 'Supabase not configured' };
  }

  const tables: Record<string, boolean> = {};

  try {
    const { error: pingError } = await supabase.from('firms').select('id').limit(1);
    if (pingError) {
      return {
        success: false,
        configured: true,
        authenticated: false,
        syncRpcReady: false,
        tables,
        error: pingError.message
      };
    }
    tables.firms = true;
  } catch (err) {
    return {
      success: false,
      configured: true,
      authenticated: false,
      syncRpcReady: false,
      tables,
      error: err instanceof Error ? err.message : String(err)
    };
  }

  let authenticated = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    authenticated = Boolean(session);
  } catch {
    authenticated = false;
  }

  let syncRpcReady = false;
  if (authenticated) {
    const { error } = await supabase.rpc('sync_pull_table', {
      table_name: 'clients',
      since_cursor: null
    });
    syncRpcReady = !error;
    if (error && import.meta.env.DEV) {
      console.info('[TEST] sync_pull_table not ready:', error.message);
    }
  }

  return {
    success: true,
    configured: true,
    authenticated,
    syncRpcReady,
    tables
  };
}

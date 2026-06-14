import { supabase } from './supabaseClient';

export async function testSupabaseConnection() {
  console.log('[TEST] Starting Supabase connection test...');
  
  // Test 1: Check if Supabase is configured
  console.log('[TEST] Checking Supabase configuration...');
  const isConfigured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  console.log('[TEST] Supabase configured:', isConfigured);
  
  if (!isConfigured) {
    console.error('[TEST] ❌ Supabase is not configured. Please check .env.local');
    return { success: false, error: 'Supabase not configured' };
  }
  
  // Test 2: Test database connection
  console.log('[TEST] Testing database connection...');
  try {
    const { error } = await supabase.from('firms').select('count').single();
    if (error) {
      console.error('[TEST] ❌ Database connection failed:', error.message);
      return { success: false, error: error.message };
    }
    console.log('[TEST] ✅ Database connection successful');
  } catch (err) {
    console.error('[TEST] ❌ Database connection error:', err);
    return { success: false, error: String(err) };
  }
  
  // Test 3: Test authentication
  console.log('[TEST] Testing authentication...');
  try {
    const { data: { session } } = await supabase.auth.getSession();
    console.log('[TEST] Current session:', session ? 'Active' : 'None');
    console.log('[TEST] ✅ Authentication service is working');
  } catch (err) {
    console.error('[TEST] ❌ Authentication error:', err);
    return { success: false, error: String(err) };
  }
  
  // Test 4: Test table existence
  console.log('[TEST] Checking required tables...');
  const requiredTables = ['firms', 'employees', 'clients', 'cases', 'sessions', 'documents', 'notifications'];
  const tableResults: Record<string, boolean> = {};
  
  for (const table of requiredTables) {
    try {
      const { error } = await supabase.from(table).select('count').limit(1);
      tableResults[table] = !error;
      if (error) {
        console.warn(`[TEST] ⚠️ Table '${table}' may not exist or RLS blocks access:`, error.message);
      } else {
        console.log(`[TEST] ✅ Table '${table}' exists and is accessible`);
      }
    } catch (err) {
      tableResults[table] = false;
      console.error(`[TEST] ❌ Error checking table '${table}':`, err);
    }
  }
  
  const allTablesExist = Object.values(tableResults).every(v => v);
  
  console.log('[TEST] Connection test complete');
  return {
    success: allTablesExist,
    configured: isConfigured,
    tables: tableResults,
    allTablesExist
  };
}

// Auto-run test in development
if (import.meta.env.DEV) {
  testSupabaseConnection().then(result => {
    console.log('[TEST] Final result:', result);
  });
}

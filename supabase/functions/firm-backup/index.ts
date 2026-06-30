import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return json({ error: 'Missing Supabase env' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({})) as {
    action?: string;
    storage_path?: string;
    size_bytes?: number;
    file_count?: number;
    tables_included?: string[];
    notes?: string;
  };

  if (body.action !== 'register') {
    return json({
      ok: true,
      message: 'Upload ZIP to storage bucket firm-backups/{firm_id}/... then POST action=register',
      bucket: 'firm-backups'
    });
  }

  const { data, error } = await userClient.rpc('register_firm_backup_storage', {
    p_storage_path: body.storage_path,
    p_size_bytes: body.size_bytes ?? 0,
    p_file_count: body.file_count ?? 0,
    p_tables_included: body.tables_included ?? [],
    p_notes: body.notes ?? null
  });

  if (error) return json({ error: error.message }, 403);
  return json({ backup_id: data });
});

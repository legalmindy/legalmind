import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

type InvitePayload = {
  email: string;
  fullName?: string;
  phone?: string;
  role: 'lawyer' | 'assistant';
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function isInvitePayload(value: unknown): value is InvitePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<InvitePayload>;
  return (
    typeof payload.email === 'string' &&
    ['lawyer', 'assistant'].includes(payload.role ?? '')
  );
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  if (!siteUrl) {
    return jsonResponse({ error: 'SITE_URL is not configured for invite redirects' }, 500);
  }

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase function environment is not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing authorization header' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { data: inviter, error: inviterError } = await adminClient
    .from('profiles')
    .select('id, firm_id, employee_id, role, firms(name)')
    .eq('id', userData.user.id)
    .is('deleted_at', null)
    .single();

  if (inviterError || !inviter?.firm_id) return jsonResponse({ error: 'Office membership not found' }, 403);
  if (inviter.role !== 'admin') {
    return jsonResponse({ error: 'Only office admins can invite users' }, 403);
  }

  const body = await req.json().catch(() => null);
  if (!isInvitePayload(body)) return jsonResponse({ error: 'Invalid invitation payload' }, 400);

  const email = body.email.trim().toLowerCase();
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const tokenHash = await sha256Hex(token);
  const redirectTo = `${siteUrl.replace(/\/$/, '')}/?page=accept-invite&token=${token}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitation, error: invitationError } = await adminClient
    .from('invitations')
    .insert({
      firm_id: inviter.firm_id,
      email,
      full_name: body.fullName?.trim() || null,
      phone: body.phone?.trim() || null,
      role: body.role,
      token_hash: tokenHash,
      invited_by: inviter.employee_id,
      expires_at: expiresAt
    })
    .select('id, email, role, expires_at')
    .single();

  if (invitationError) return jsonResponse({ error: invitationError.message }, 400);

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      full_name: body.fullName ?? '',
      invitation_token: token,
      firm_id: inviter.firm_id,
      role: body.role
    }
  });

  if (inviteError) {
    await adminClient.from('invitations').update({ status: 'cancelled' }).eq('id', invitation.id);
    return jsonResponse({ error: inviteError.message }, 400);
  }

  return jsonResponse({ invitation, acceptUrl: redirectTo });
});

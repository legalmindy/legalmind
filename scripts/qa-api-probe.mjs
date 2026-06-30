/**
 * LegalMind Yemen — QA API probe (staging only).
 * Usage: node scripts/qa-api-probe.mjs
 * Requires: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env.local
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '').trim();
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
}

loadEnv();

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;

const results = [];

function pass(name, detail = '') {
  results.push({ name, status: 'PASS', detail });
}
function fail(name, detail = '') {
  results.push({ name, status: 'FAIL', detail });
}
function skip(name, detail = '') {
  results.push({ name, status: 'SKIP', detail });
}
function warn(name, detail = '') {
  results.push({ name, status: 'WARN', detail });
}

async function main() {
  if (!url || !anon) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  // 1. Anonymous access to tenant data should be blocked
  const { data: anonFirms, error: anonFirmsErr } = await supabase.from('firms').select('id').limit(5);
  if (anonFirmsErr || !anonFirms?.length) {
    pass('RLS: anon cannot read firms', anonFirmsErr?.message ?? 'empty result');
  } else {
    fail('RLS: anon can read firms', `rows=${anonFirms.length}`);
  }

  const { data: anonCases } = await supabase.from('cases').select('id').limit(5);
  if (!anonCases?.length) {
    pass('RLS: anon cannot read cases');
  } else {
    fail('RLS: anon can read cases', `rows=${anonCases.length}`);
  }

  // 2. SQL injection in filter (PostgREST should parameterize)
  const payload = "'; DROP TABLE cases; --";
  const { error: sqliErr } = await supabase.from('clients').select('id').eq('full_name', payload).limit(1);
  if (!sqliErr || !/syntax|drop/i.test(sqliErr.message ?? '')) {
    pass('SQLi probe: filter tolerated without SQL error', sqliErr?.message ?? 'ok');
  } else {
    fail('SQLi probe: unexpected SQL error', sqliErr.message);
  }

  // 3. Public RPCs
  const { error: inviteErr } = await supabase.rpc('get_invitation_by_token', {
    raw_token: '0000000000000000000000000000000000000000000000000000000000000000'
  });
  if (inviteErr) {
    pass('Public RPC: invalid invite token rejected', inviteErr.message?.slice(0, 80));
  } else {
    warn('Public RPC: invalid invite returned data');
  }

  const { data: roles, error: rolesErr } = await supabase.rpc('get_firm_roles_for_registration', {
    office_code_input: 'INVALID-0000'
  });
  if (rolesErr || !roles?.length) {
    pass('Public RPC: invalid firm code returns empty/error');
  } else {
    warn('Public RPC: invalid firm code returned roles');
  }

  // 4. Auth required endpoints without session
  const { error: pendingErr } = await supabase.rpc('list_pending_member_registrations');
  if (pendingErr) {
    pass('Auth RPC: list_pending requires session', pendingErr.message?.slice(0, 80));
  } else {
    fail('Auth RPC: list_pending without auth succeeded');
  }

  // 5. Latency baseline (anon)
  const t0 = performance.now();
  await supabase.from('public_testimonials').select('id').limit(10);
  const ms = Math.round(performance.now() - t0);
  if (ms < 2000) {
    pass('Latency: public_testimonials < 2s', `${ms}ms`);
  } else {
    warn('Latency: public_testimonials slow', `${ms}ms`);
  }

  const summary = {
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    warn: results.filter((r) => r.status === 'WARN').length,
    skip: results.filter((r) => r.status === 'SKIP').length
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

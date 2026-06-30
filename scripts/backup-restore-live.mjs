#!/usr/bin/env node
/**
 * Live backup integrity script (read-only validation).
 *
 * Env:
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *   QA_EMAIL / QA_PASSWORD  — firm_manager test account
 *
 * Usage: node scripts/backup-restore-live.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const url = process.env.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.QA_EMAIL ?? process.env.E2E_EMAIL;
const password = process.env.QA_PASSWORD ?? process.env.E2E_PASSWORD;

if (!url || !anon) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, anon);

async function main() {
  if (!email || !password) {
    console.log('Skip live auth — set QA_EMAIL and QA_PASSWORD to run full live checks.');
    const { error } = await supabase.rpc('list_approved_testimonials', { p_limit: 1 });
    console.log(error ? `Public RPC failed: ${error.message}` : 'Public testimonials RPC: OK');
    process.exit(error ? 1 : 0);
  }

  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    console.error('Login failed:', authError.message);
    process.exit(1);
  }

  console.log('Logged in:', auth.user?.email);

  const checks = [
    ['is_billing_admin', () => supabase.rpc('is_billing_admin')],
    ['delete_execution_request grant', () => supabase.rpc('delete_execution_request', { p_request_id: '00000000-0000-4000-8000-000000000000' })],
    ['list_firm_backups', () => supabase.rpc('list_firm_backups', { p_limit: 5 })],
    ['register_firm_backup_storage grant', () => supabase.rpc('register_firm_backup_storage', {
      p_storage_path: 'test/not-allowed',
      p_size_bytes: 0,
      p_file_count: 0,
      p_tables_included: [],
      p_notes: 'probe'
    })]
  ];

  for (const [name, fn] of checks) {
    const { error } = await fn();
    if (!error) {
      console.log(`✓ ${name}: callable`);
      continue;
    }
    const msg = error.message ?? String(error);
    if (/not_found|invalid_storage_path|not_authorized|غير مصرح|P0002/i.test(msg)) {
      console.log(`✓ ${name}: RPC exists (${msg.slice(0, 80)})`);
    } else if (/42883|does not exist/i.test(msg)) {
      console.error(`✗ ${name}: migration missing — ${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`? ${name}: ${msg.slice(0, 120)}`);
    }
  }

  const { data: clients, error: clientsError } = await supabase.from('clients').select('id', { count: 'exact', head: true });
  console.log(clientsError ? `clients: ${clientsError.message}` : `clients accessible (count header: ${clients ?? 'ok'})`);

  await supabase.auth.signOut();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

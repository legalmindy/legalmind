#!/usr/bin/env node
/**
 * Writes src/lib/productionSupabase.ts from .env.local (or process env).
 * Anon key is a public client credential protected by RLS — not a service role.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const fileEnv = loadEnvFile(envPath);
const url = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}
if (url.includes('dlkxzjyvcmsgnovwmntd.supabase.co')) {
  console.error('Refusing to bake retired Supabase URL');
  process.exit(1);
}

const outPath = join(root, 'src', 'lib', 'productionSupabase.ts');
const source = `/**
 * Production Supabase defaults for LegalMind Yemen.
 * Used when VITE_* is missing or points at a retired project so Android/Web
 * never ship a dead backend. The anon key is a public client key (RLS enforces
 * access) — not a secret service-role key.
 */
export const PRODUCTION_SUPABASE_URL = ${JSON.stringify(url)} as const;
export const PRODUCTION_SUPABASE_ANON_KEY = ${JSON.stringify(key)} as const;
`;

writeFileSync(outPath, source, 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`host=${new URL(url).host} keyLen=${key.length}`);

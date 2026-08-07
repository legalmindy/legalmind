#!/usr/bin/env node
/**
 * Guardrail: fail the build if the bundled frontend still points at a deleted
 * Supabase project (or is missing the active production host).
 *
 * Root cause this prevents:
 * Android WebView "Failed to fetch" on login when assets still embed a retired
 * host that no longer resolves in DNS.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distAssets = join(root, 'dist', 'assets');

const ACTIVE_URL = 'https://gnsjjsvugafxkwgmvcev.supabase.co';
/** Full URL form means env/build still targets the deleted project (hostname alone is OK in RETIRED lists). */
const RETIRED_URLS = ['https://dlkxzjyvcmsgnovwmntd.supabase.co'];

function readBundledJs() {
  if (!existsSync(distAssets)) {
    console.error(`[assert-supabase-build] Missing dist/assets. Run "npm run build" first.`);
    process.exit(1);
  }
  const files = readdirSync(distAssets).filter((f) => f.endsWith('.js'));
  if (files.length === 0) {
    console.error('[assert-supabase-build] No JS bundles found in dist/assets.');
    process.exit(1);
  }
  return files.map((f) => ({
    name: f,
    text: readFileSync(join(distAssets, f), 'utf8')
  }));
}

const bundles = readBundledJs();
const allText = bundles.map((b) => b.text).join('\n');

const retiredHits = RETIRED_URLS.filter((url) => allText.includes(url));
if (retiredHits.length > 0) {
  console.error(
    `[assert-supabase-build] FAIL: bundled assets still use retired Supabase URL(s):\n` +
      retiredHits.map((h) => `  - ${h}`).join('\n') +
      `\nUpdate VITE_SUPABASE_URL in .env.local, rebuild, then cap sync.`
  );
  process.exit(1);
}

if (!allText.includes(ACTIVE_URL)) {
  console.error(
    `[assert-supabase-build] FAIL: active Supabase URL "${ACTIVE_URL}" was not found in dist bundles.\n` +
      `Ensure VITE_SUPABASE_URL is set for the production build.`
  );
  process.exit(1);
}

if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?[^"'`\s]*supabase/i.test(allText)) {
  console.error('[assert-supabase-build] FAIL: local Supabase URL detected in production bundle.');
  process.exit(1);
}

console.log(`[assert-supabase-build] OK — bundles target ${ACTIVE_URL}`);

#!/usr/bin/env node
/**
 * After `cap sync`, confirm Android WebView assets embed the active Supabase host
 * (and never a retired one). Catches stale sync / partial copies.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const androidAssets = join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'assets');

const ACTIVE_URL = 'https://gnsjjsvugafxkwgmvcev.supabase.co';
const RETIRED_URLS = ['https://dlkxzjyvcmsgnovwmntd.supabase.co'];

if (!existsSync(androidAssets)) {
  console.error('[assert-android-assets] Missing android/.../assets/public/assets. Run cap sync first.');
  process.exit(1);
}

const files = readdirSync(androidAssets).filter((f) => f.endsWith('.js'));
const allText = files.map((f) => readFileSync(join(androidAssets, f), 'utf8')).join('\n');

const retiredHits = RETIRED_URLS.filter((url) => allText.includes(url));
if (retiredHits.length > 0) {
  console.error(
    `[assert-android-assets] FAIL: Android assets still use retired URL(s): ${retiredHits.join(', ')}`
  );
  process.exit(1);
}

if (!allText.includes(ACTIVE_URL)) {
  console.error(
    `[assert-android-assets] FAIL: active URL "${ACTIVE_URL}" not found in Android WebView assets.`
  );
  process.exit(1);
}

console.log(`[assert-android-assets] OK — Android assets target ${ACTIVE_URL}`);

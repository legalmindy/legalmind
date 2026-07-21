#!/usr/bin/env node
/**
 * Updates public/app-release.json after a CI Android build.
 * Usage: node scripts/update-release-manifest.mjs <version> <versionCode> <apkFileName>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , version, versionCode, apkFileName] = process.argv;

if (!version || !versionCode || !apkFileName) {
  console.error('Usage: update-release-manifest.mjs <version> <versionCode> <apkFileName>');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '..', 'public', 'app-release.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

manifest.version = version;
manifest.versionCode = Number(versionCode);
manifest.releasedAt = new Date().toISOString().slice(0, 10);
manifest.apkFileName = apkFileName;
manifest.apkUrl = `/downloads/${apkFileName}`;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${manifestPath} -> v${version} (${versionCode}) -> ${apkFileName}`);

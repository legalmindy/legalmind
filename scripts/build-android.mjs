#!/usr/bin/env node
/**
 * Build LegalMind Yemen Android artifacts and publish them to public/downloads
 * so the /download page + in-app update checker always point at a real file.
 *
 * Usage:
 *   node scripts/build-android.mjs [--debug|--release|--aab]
 *
 * Debug builds are signed automatically by the Android Gradle Plugin's default
 * debug keystore, so the resulting APK installs on any device with "unknown
 * sources" enabled — no extra signing setup required.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const androidDir = join(root, 'android');
const downloadsDir = join(root, 'public', 'downloads');

const mode = process.argv.includes('--aab')
  ? 'aab'
  : process.argv.includes('--debug')
    ? 'debug'
    : process.argv.includes('--release')
      ? 'release'
      : 'debug';

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root, shell: true, ...opts });
}

function readVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  return pkg.version;
}

function versionCodeFor(version) {
  const [major, minor, patch] = version.split('.').map((n) => Number(n) || 0);
  return major * 100 + minor * 10 + patch;
}

function clearOldArtifacts(extension) {
  mkdirSync(downloadsDir, { recursive: true });
  for (const file of readdirSync(downloadsDir)) {
    if (file.endsWith(extension)) rmSync(join(downloadsDir, file), { force: true });
  }
}

if (!existsSync(androidDir)) {
  console.error('Android project not found. Run: npx cap add android && npm run cap:sync');
  process.exit(1);
}

run('npm run build');
run('npx cap sync android');

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const version = readVersion();
const versionCode = versionCodeFor(version);

if (mode === 'aab') {
  run(`${gradlew} bundleRelease`, { cwd: androidDir });
  const aabSrc = join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  clearOldArtifacts('.aab');
  const aabDest = join(downloadsDir, `legalmind-yemen-${version}.aab`);
  if (existsSync(aabSrc)) {
    cpSync(aabSrc, aabDest);
    console.log(`\nAAB copied to ${aabDest}`);
  }
} else if (mode === 'release') {
  run(`${gradlew} assembleRelease`, { cwd: androidDir });
  const apkSrc = join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  clearOldArtifacts('.apk');
  const filename = `legalmind-yemen-${version}.apk`;
  const apkDest = join(downloadsDir, filename);
  if (existsSync(apkSrc)) {
    cpSync(apkSrc, apkDest);
    run(`node scripts/update-release-manifest.mjs ${version} ${versionCode} ${filename}`);
    console.log(`\nRelease APK published to ${apkDest}`);
    console.log('NOTE: release builds need a real signingConfig in android/app/build.gradle before this APK can be installed.');
  }
} else {
  run(`${gradlew} assembleDebug`, { cwd: androidDir });
  const apkSrc = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  clearOldArtifacts('.apk');
  const filename = `legalmind-yemen-${version}.apk`;
  const apkDest = join(downloadsDir, filename);
  if (existsSync(apkSrc)) {
    cpSync(apkSrc, apkDest);
    run(`node scripts/update-release-manifest.mjs ${version} ${versionCode} ${filename}`);
    console.log(`\nDebug APK published to ${apkDest} and public/app-release.json updated.`);
    console.log('Commit + push public/downloads and public/app-release.json to publish it on the website.');
  }
}

console.log('\nAndroid build finished.');

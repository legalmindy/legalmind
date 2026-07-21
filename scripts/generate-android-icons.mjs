/**
 * Generate LegalMind Android launcher icons + splash from brand SVG.
 * Uses sharp (devDependency / one-shot) to rasterize.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const res = join(root, 'android', 'app', 'src', 'main', 'res');

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    console.log('Installing sharp temporarily...');
    const r = spawnSync('npm', ['install', '--no-save', 'sharp'], {
      cwd: root,
      stdio: 'inherit',
      shell: true
    });
    if (r.status !== 0) process.exit(1);
    return (await import(pathToFileURL(join(root, 'node_modules', 'sharp', 'lib', 'index.js')).href)).default;
  }
}

const BRAND = '#7A1F2B';

/** Full brand mark: burgundy rounded square + white scales (matches public/favicon.svg). */
function brandSvg(size, { rounded = true, pad = 0.12 } = {}) {
  const rx = rounded ? Math.round(size * 0.22) : 0;
  // Inner content uses same relative geometry as favicon (24x24 icon in 32x32).
  const inset = size * pad;
  const s = size - inset * 2;
  const scale = s / 24;
  const tx = inset;
  const ty = inset;
  const sw = Math.max(1.5, 2 * scale);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${BRAND}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="${sw / scale}" stroke-linecap="round" stroke-linejoin="round">
    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
    <path d="M7 21h10"/>
    <path d="M12 3v18"/>
    <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>
  </g>
</svg>`;
}

/** Adaptive foreground: white scales on transparent, safe-zone padded for Android adaptive icons. */
function foregroundSvg(size = 432) {
  // Adaptive icon viewport is 108dp; safe zone ~66dp center. Use generous padding.
  const pad = size * 0.22;
  const s = size - pad * 2;
  const scale = s / 24;
  const sw = Math.max(2, 2.2 * scale);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${pad} ${pad}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="${sw / scale}" stroke-linecap="round" stroke-linejoin="round">
    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
    <path d="M7 21h10"/>
    <path d="M12 3v18"/>
    <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>
  </g>
</svg>`;
}

/** Splash: full-bleed brand color with centered logo. */
function splashSvg(w, h) {
  const logo = Math.round(Math.min(w, h) * 0.28);
  const x = Math.round((w - logo) / 2);
  const y = Math.round((h - logo) / 2);
  const inner = brandSvg(logo, { rounded: true, pad: 0.14 })
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace('</svg>', '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BRAND}"/>
  <g transform="translate(${x} ${y})">${inner}</g>
</svg>`;
}

let sharp;
async function writePng(svg, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log('wrote', outPath.replace(root + '\\', '').replace(root + '/', ''));
}

const dens = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192
};

const fgDens = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432
};

async function main() {
  sharp = await loadSharp();
  for (const [dpi, size] of Object.entries(dens)) {
    const svg = brandSvg(size, { rounded: false, pad: 0.14 });
    const roundSvg = brandSvg(size, { rounded: true, pad: 0.14 });
    await writePng(svg, join(res, `mipmap-${dpi}`, 'ic_launcher.png'));
    await writePng(roundSvg, join(res, `mipmap-${dpi}`, 'ic_launcher_round.png'));
  }

  for (const [dpi, size] of Object.entries(fgDens)) {
    await writePng(foregroundSvg(size), join(res, `mipmap-${dpi}`, 'ic_launcher_foreground.png'));
  }

  // Solid brand background for adaptive icon (replace Capacitor teal grid)
  writeFileSync(
    join(res, 'drawable', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="${BRAND}" />
</shape>
`
  );

  // Adaptive icons: burgundy bg + white scales foreground
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
  writeFileSync(join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);

  // Ensure color resource
  writeFileSync(
    join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BRAND}</color>
</resources>
`
  );

  // Splash screens (portrait + land + default)
  const splashTargets = [
    ['drawable', 1080, 1920],
    ['drawable-port-mdpi', 320, 480],
    ['drawable-port-hdpi', 480, 800],
    ['drawable-port-xhdpi', 720, 1280],
    ['drawable-port-xxhdpi', 1080, 1920],
    ['drawable-port-xxxhdpi', 1440, 2560],
    ['drawable-land-mdpi', 480, 320],
    ['drawable-land-hdpi', 800, 480],
    ['drawable-land-xhdpi', 1280, 720],
    ['drawable-land-xxhdpi', 1920, 1080],
    ['drawable-land-xxxhdpi', 2560, 1440]
  ];

  for (const [folder, w, h] of splashTargets) {
    await writePng(splashSvg(w, h), join(res, folder, 'splash.png'));
  }

  // Remove obsolete vector foreground if it conflicts (keep file but unused)
  const oldFg = join(res, 'drawable-v24', 'ic_launcher_foreground.xml');
  if (existsSync(oldFg)) {
    writeFileSync(
      oldFg,
      `<?xml version="1.0" encoding="utf-8"?>
<!-- Replaced by mipmap/*/ic_launcher_foreground.png (LegalMind brand). Kept empty to avoid stale Capacitor asset. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#00000000" android:pathData="M0,0h108v108h-108z" />
</vector>
`
    );
  }

  console.log('Done: LegalMind launcher + splash assets generated.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

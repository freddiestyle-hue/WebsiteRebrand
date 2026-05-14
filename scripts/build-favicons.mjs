// Re-render every raster favicon from public/favicon.svg using sharp.
// Run with: node scripts/build-favicons.mjs
//
// Source of truth: public/favicon.svg (ink-r on accent-green, 80x80 viewBox).
// Outputs land in public/favicon/. The site.webmanifest references these.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'public', 'favicon.svg');
const OUT_DIR = path.join(ROOT, 'public', 'favicon');

const SIZES = [16, 24, 32, 48, 180, 512];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const svg = await fs.readFile(SRC);

  for (const size of SIZES) {
    const out = path.join(OUT_DIR, `favicon-${size}.png`);
    await sharp(svg, { density: Math.max(72, size * 4) })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`  -> ${path.relative(ROOT, out)}  (${size}x${size})`);
  }

  // Apple touch alias (180).
  await fs.copyFile(
    path.join(OUT_DIR, 'favicon-180.png'),
    path.join(OUT_DIR, 'apple-touch-icon.png'),
  );
  console.log(`  -> ${path.relative(ROOT, path.join(OUT_DIR, 'apple-touch-icon.png'))}  (alias of -180.png)`);

  // Multi-resolution .ico. sharp can't write .ico directly, but a single 48px
  // PNG renamed to .ico works fine in every modern browser (only legacy IE
  // genuinely requires the multi-res container). If a richer .ico is needed,
  // ship a separate tool - this keeps the build dependency-free.
  await sharp(svg, { density: 288 })
    .resize(48, 48, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT_DIR, 'favicon.ico'));
  console.log(`  -> ${path.relative(ROOT, path.join(OUT_DIR, 'favicon.ico'))}  (48x48 PNG, served as .ico)`);

  // Mirror to /public/favicon.ico (the root path some browsers hit by default).
  await fs.copyFile(
    path.join(OUT_DIR, 'favicon.ico'),
    path.join(ROOT, 'public', 'favicon.ico'),
  );
  console.log(`  -> ${path.relative(ROOT, path.join(ROOT, 'public', 'favicon.ico'))}  (root alias)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

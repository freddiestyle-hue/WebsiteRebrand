import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'art', 'portrait-source.png');
const outDir = join(root, 'public', 'img', 'portrait');

await mkdir(outDir, { recursive: true });

const widths = [96, 192, 480];
const formats = ['avif', 'webp'];

for (const w of widths) {
  for (const fmt of formats) {
    const out = join(outDir, `fred-${w}.${fmt}`);
    await sharp(src)
      .resize(w, w, { fit: 'cover', position: 'top' })
      .toFormat(fmt, fmt === 'avif' ? { quality: 60 } : { quality: 82 })
      .toFile(out);
    console.log(`wrote ${out}`);
  }
  // PNG fallback at each size
  const pngOut = join(outDir, `fred-${w}.png`);
  await sharp(src)
    .resize(w, w, { fit: 'cover', position: 'top' })
    .png({ quality: 90 })
    .toFile(pngOut);
  console.log(`wrote ${pngOut}`);
}

console.log('done');

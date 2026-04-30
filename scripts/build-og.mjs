import sharp from 'sharp';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const out = join(root, 'public', 'og-default.png');
await mkdir(dirname(out), { recursive: true });

const W = 1200, H = 630;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      .grotesk { font-family: 'Inter Tight', 'Inter', system-ui, sans-serif; }
      .serif { font-family: 'Newsreader', Georgia, serif; font-style: italic; }
      .mono { font-family: 'DM Mono', ui-monospace, monospace; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" fill="#FFFFFF"/>
  <line x1="80" y1="80" x2="${W - 80}" y2="80" stroke="rgba(14,26,44,0.14)" stroke-width="1"/>
  <line x1="80" y1="${H - 80}" x2="${W - 80}" y2="${H - 80}" stroke="rgba(14,26,44,0.14)" stroke-width="1"/>

  <g transform="translate(80, 60)">
    <text class="grotesk" x="0" y="20" font-size="32" font-weight="700" letter-spacing="-1.5" fill="#0E1A2C">rivett</text>
    <circle cx="100" cy="14" r="6" fill="#6FB582"/>
  </g>

  <g transform="translate(80, ${H - 100})">
    <text class="mono" x="0" y="0" font-size="14" letter-spacing="3" fill="#3F7553">PERFORMANCE MARKETING FOR OPERATORS</text>
    <text class="mono" x="${W - 160 - 80}" y="0" font-size="14" letter-spacing="3" fill="#7A8597">RIVETT.TECH</text>
  </g>

  <g transform="translate(80, 280)">
    <text class="grotesk" x="0" y="0" font-size="92" font-weight="700" letter-spacing="-4" fill="#0E1A2C">Senior operator,</text>
    <text class="serif" x="0" y="100" font-size="92" font-weight="400" letter-spacing="-2" fill="#3A4658">not an agency.</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg))
  .png({ quality: 92 })
  .toFile(out);

console.log(`wrote ${out}`);

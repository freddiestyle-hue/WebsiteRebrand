#!/usr/bin/env node
/**
 * fetch-fonts.mjs
 *
 * Pulls WOFF2 files for Inter Tight, Newsreader, and DM Mono from the Google
 * Fonts CDN and drops them in this folder under the names referenced by
 * `fonts.css`. Run from the project root, with Node 18+ (built-in fetch):
 *
 *     node fonts/fetch-fonts.mjs
 *
 * Once the WOFF2s are in place, replace the @import at the top of tokens.css
 * with:
 *
 *     @import url('./fonts/fonts.css');
 *
 * That swaps the system to fully self-hosted type. The original Google Fonts
 * @import line can be removed.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Each entry: a Google Fonts CSS2 URL that lists the weights/styles you want,
// plus the local filename per (weight, style). The URLs are stable; we ask the
// API with a UA that wants WOFF2 so the @font-face src points to .woff2 files.
const FAMILIES = [
  {
    name: 'Inter Tight',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&display=swap',
    map: {
      '400 normal': 'inter-tight-400.woff2',
      '500 normal': 'inter-tight-500.woff2',
      '600 normal': 'inter-tight-600.woff2',
      '700 normal': 'inter-tight-700.woff2',
      '800 normal': 'inter-tight-800.woff2',
    },
  },
  {
    name: 'Newsreader',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;1,400;1,500&display=swap',
    map: {
      '400 normal':  'newsreader-400.woff2',
      '500 normal':  'newsreader-500.woff2',
      '400 italic':  'newsreader-400-italic.woff2',
      '500 italic':  'newsreader-500-italic.woff2',
    },
  },
  {
    name: 'DM Mono',
    cssUrl: 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap',
    map: {
      '300 normal': 'dm-mono-300.woff2',
      '400 normal': 'dm-mono-400.woff2',
      '500 normal': 'dm-mono-500.woff2',
    },
  },
];

// Pretend to be a modern browser so the API returns the WOFF2 URLs.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

async function fetchCss(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`CSS fetch ${url} → ${r.status}`);
  return r.text();
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font fetch ${url} → ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Parse a Google Fonts CSS payload into a list of (weight, style, url, family).
function parseFontFaces(css) {
  const blocks = css.split('@font-face').slice(1);
  const out = [];
  for (const blk of blocks) {
    const family = (blk.match(/font-family:\s*'([^']+)'/) || [])[1];
    const style  = (blk.match(/font-style:\s*(\w+)/) || [])[1] || 'normal';
    const weight = (blk.match(/font-weight:\s*(\d+)/) || [])[1];
    const url    = (blk.match(/url\(([^)]+)\)\s*format\('woff2'\)/) || [])[1];
    if (family && weight && url) out.push({ family, weight, style, url });
  }
  return out;
}

async function main() {
  await mkdir(HERE, { recursive: true });
  let written = 0, skipped = 0;
  for (const fam of FAMILIES) {
    console.log(`\n· ${fam.name}`);
    const css = await fetchCss(fam.cssUrl);
    const faces = parseFontFaces(css);
    if (!faces.length) {
      console.warn(`  no WOFF2 faces parsed from ${fam.cssUrl}`);
      continue;
    }
    for (const f of faces) {
      const key = `${f.weight} ${f.style}`;
      const local = fam.map[key];
      if (!local) { skipped++; continue; }
      const bytes = await fetchBytes(f.url);
      await writeFile(`${HERE}/${local}`, bytes);
      console.log(`  ${local}  (${bytes.length.toLocaleString()} B)`);
      written++;
    }
  }
  console.log(`\n${written} file(s) written, ${skipped} skipped.`);
  console.log('Now in tokens.css, replace the Google @import with:');
  console.log("    @import url('./fonts/fonts.css');");
}

main().catch(err => { console.error(err); process.exit(1); });

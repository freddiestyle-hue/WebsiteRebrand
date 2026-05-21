// Navigate to a URL and screenshot it (top + full page). For eyeballing a
// live page next to a locally-generated one.
//
// Run: npx tsx scripts/shoot-url.ts <url> [name]

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2];
const name = process.argv[3] ?? 'shot';
if (!url) {
  console.error('Usage: npx tsx scripts/shoot-url.ts <url> [name]');
  process.exit(1);
}

const outDir = 'scripts/.teardown-shots';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  console.log(`status: ${resp?.status()}  title: "${await page.title()}"`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${name}-top.png` });
  await page.screenshot({ path: `${outDir}/${name}-full.png`, fullPage: true });
  console.log(`saved ${outDir}/${name}-top.png and ${name}-full.png`);
} catch (e) {
  console.error('failed:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

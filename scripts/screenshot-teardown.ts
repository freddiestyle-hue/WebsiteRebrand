// Drives the local dev server's v3 teardown page: submits a URL, waits for
// the audit to run, and screenshots the rendered teardown - the report a
// prospect would receive.
//
// Run: npx tsx scripts/screenshot-teardown.ts http://localhost:4321 recostseg.com

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2];
const target = process.argv[3];
if (!base || !target) {
  console.error('Usage: npx tsx scripts/screenshot-teardown.ts <devserver-base> <url>');
  process.exit(1);
}

const outDir = 'scripts/.teardown-shots';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/audit/v3`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="url"]', target);
  console.log(`submitted ${target}, waiting for the audit (can take ~60-90s)...`);
  // Set up the navigation wait BEFORE pressing Enter; keyboard.press avoids
  // the element-actionability re-check that races with the form navigation.
  const nav = page.waitForNavigation({ waitUntil: 'networkidle', timeout: 180000 });
  await page.keyboard.press('Enter');
  await nav;
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${outDir}/recostseg-full.png`, fullPage: true });
  await page.screenshot({ path: `${outDir}/recostseg-top.png` });
  const title = await page.title();
  console.log(`done. page title: "${title}"`);
  console.log(`saved: ${outDir}/recostseg-full.png and recostseg-top.png`);
} catch (e) {
  console.error('failed:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

// Local audit runner. Runs the rebuilt audit against a URL using the system
// Chrome (playwright-core `channel: 'chrome'`), because the production
// headless engine (@sparticuz/chromium) is Linux-only and cannot launch on
// macOS. Lets Upgrades 2 + 3 (rendered DOM, live tracking) be exercised
// locally before a Vercel deploy.
//
// Run: npx tsx scripts/audit-local.ts https://example.com

import { chromium } from 'playwright-core';
import { runAudit, type AuditResult } from '../src/utils/audit/engine';
import { isTrackingHost, type HeadlessTrackingCapture } from '../src/utils/audit/tracking';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npx tsx scripts/audit-local.ts <url>');
  process.exit(1);
}

async function capture(
  target: string,
): Promise<{ renderedHtml: string; tracking: HeadlessTrackingCapture } | null> {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    console.log(`  (system Chrome unavailable: ${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const beaconUrls = new Set<string>();
    context.on('request', (req) => {
      try {
        const u = new URL(req.url());
        if (isTrackingHost(u.hostname)) beaconUrls.add(req.url());
      } catch {
        /* ignore */
      }
    });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(1500);
    const renderedHtml = await page.content();
    const runtime = await page
      .evaluate(() => {
        const events: string[] = [];
        const gtmIds: string[] = [];
        const ga4Ids: string[] = [];
        try {
          const dl = (window as unknown as { dataLayer?: unknown }).dataLayer;
          if (Array.isArray(dl)) {
            for (const e of dl) {
              const ev = (e as { event?: unknown })?.event;
              if (typeof ev === 'string') events.push(ev);
            }
          }
        } catch {
          /* ignore */
        }
        try {
          const gtm = (window as unknown as { google_tag_manager?: Record<string, unknown> })
            .google_tag_manager;
          if (gtm) {
            for (const k of Object.keys(gtm)) {
              if (/^GTM-/.test(k)) gtmIds.push(k);
              else if (/^G-/.test(k)) ga4Ids.push(k);
            }
          }
        } catch {
          /* ignore */
        }
        return { events, gtmIds, ga4Ids };
      })
      .catch(() => ({ events: [], gtmIds: [], ga4Ids: [] }));
    return {
      renderedHtml,
      tracking: {
        beaconUrls: [...beaconUrls].sort(),
        dataLayerEvents: [...new Set(runtime.events)].sort(),
        gtmContainerIds: [...new Set(runtime.gtmIds)].sort(),
        ga4MeasurementIds: [...new Set(runtime.ga4Ids)].sort(),
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function report(label: string, r: AuditResult): void {
  console.log(`\n## ${label}`);
  if (r.error) {
    console.log(`  ERROR: ${r.error}`);
    return;
  }
  console.log(`  ${r.hostname}  score ${r.scorePercent}% (${r.bandLabel})  ${r.durationMs}ms`);
  for (const c of r.checks) {
    console.log(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.id.padEnd(26)} ${c.evidence}`);
  }
}

const staticResult = await runAudit(url);
report('STATIC ONLY', staticResult);

const cap = await capture(url);
if (cap) {
  console.log(
    `\n  headless capture: ${cap.tracking.beaconUrls.length} beacon URLs, ` +
      `${cap.tracking.dataLayerEvents.length} dataLayer events, ` +
      `GTM [${cap.tracking.gtmContainerIds.join(', ') || 'none'}], ` +
      `GA4 [${cap.tracking.ga4MeasurementIds.join(', ') || 'none'}]`,
  );
  const fullResult = await runAudit(url, {
    renderedHtml: cap.renderedHtml,
    headlessTracking: cap.tracking,
  });
  report('FULL (rendered DOM + live tracking)', fullResult);

  console.log('\n## DELTA (static -> full)');
  let any = false;
  for (const c of fullResult.checks) {
    const s = staticResult.checks.find((x) => x.id === c.id);
    if (s && s.passed !== c.passed) {
      any = true;
      console.log(`  ${c.id}: ${s.passed ? 'PASS -> FAIL' : 'FAIL -> PASS'}`);
    }
  }
  if (!any) console.log('  (no check flipped - static and full agree)');
} else {
  console.log('\n  Full rendered/tracking run skipped - no local browser.');
}

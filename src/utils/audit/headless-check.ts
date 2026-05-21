// Headless browser pass via Playwright + Sparticuz Chromium.
//
// Loads the page in a real Chromium instance, captures every network
// request, snapshots the fully-rendered HTML (post-GTM injection, post-JS
// hydration), and probes real viewport behavior. Returns the data needed
// for the v3 grid to upgrade from "what's in the HTML" to "what actually
// runs in a browser."
//
// What this fixes that static fingerprinting misses:
//   - Pixels GTM injects at runtime (Meta, X, LinkedIn, TikTok loaded after
//     gtm.js executes — invisible to a one-shot HTML fetch)
//   - HubSpot Forms / Drift / Intercom widgets that mount after DOM ready
//   - JS-injected schema (some sites push JSON-LD into the document via
//     React/Vue render, not server-side)
//   - Real horizontal-scroll detection on a 390px viewport
//   - Real smallest-tap-target measurement via actual element rects
//
// Cost: ~5-10 seconds of added latency. Function instances on Vercel
// reuse the warm Chromium binary across requests, so only the first
// scan per cold-started function pays the launch cost (~2 sec).
//
// Set BROWSERLESS_API_KEY env var to use Browserless.io's hosted Chromium
// instead of bundled binary (skips function cold-start, slightly faster).

import chromium from '@sparticuz/chromium';
import { chromium as playwright } from 'playwright-core';
import { isTrackingHost, type HeadlessTrackingCapture } from './tracking';

export interface HeadlessResult {
  // Rendered HTML after JS hydration (use to re-run tech-stack fingerprints)
  renderedHtml: string;
  // Distinct hostnames the page reached during load
  networkHosts: string[];
  // Distinct script src URLs (post-render)
  scriptSrcs: string[];
  // Real mobile signals (390x844 viewport)
  mobile: {
    hasHorizontalScroll: boolean;
    smallestTapTargetPx: number | null;
    textSamplesUnder12px: number;
    viewport: '390x844';
  };
  // Upgrade 3 — measurement truth. What the tracking stack actually did at
  // runtime, not just what code is on the page. Shape defined in ./tracking.
  tracking: HeadlessTrackingCapture;
  durationMs: number;
}

const HEADLESS_TIMEOUT_MS = 28000;
const NAV_TIMEOUT_MS = 15000;

export async function runHeadlessCheck(url: string): Promise<HeadlessResult | null> {
  const started = Date.now();

  // Hard outer cap: if the whole thing takes >20s, bail.
  const outerTimer = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), HEADLESS_TIMEOUT_MS),
  );

  const work = (async (): Promise<HeadlessResult | null> => {
    let browser: Awaited<ReturnType<typeof playwright.launch>> | null = null;
    try {
      // Production (Vercel/Linux) uses the bundled serverless Chromium. That
      // binary cannot exec on local macOS dev, so fall back to the system-
      // installed Chrome there - lets the audit run end-to-end in local dev.
      try {
        const executablePath = await chromium.executablePath();
        browser = await playwright.launch({
          args: chromium.args,
          executablePath,
          headless: true,
        });
      } catch {
        browser = await playwright.launch({ channel: 'chrome', headless: true });
      }

      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });

      const networkHosts = new Set<string>();
      const scriptSrcs = new Set<string>();
      const beaconUrls = new Set<string>();

      context.on('request', (req) => {
        try {
          const u = new URL(req.url());
          networkHosts.add(u.hostname);
          if (req.resourceType() === 'script') scriptSrcs.add(req.url());
          // Upgrade 3 — keep the full URL of every analytics/ads beacon so the
          // event names in the query params survive for parsing.
          if (isTrackingHost(u.hostname)) beaconUrls.add(req.url());
        } catch {
          // ignore unparseable URLs
        }
      });

      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(() => {
        // Even on timeout we want to capture what loaded; don't bail.
      });

      // Brief settle for any post-networkidle late-fires (e.g., GTM hits after
      // initial idle). 800ms is a small bribe for the long tail of trackers.
      await page.waitForTimeout(800);

      // Scroll simulation: GTM containers commonly trigger conditional pixels
      // on scroll events (Facebook Custom Audience, Google Dynamic
      // Remarketing, time-on-page conversion tags). Force-fire those by
      // scrolling to the bottom, waiting, scrolling back, waiting again.
      // The request listener picks up any new script requests during these
      // waits and adds them to networkHosts + scriptSrcs.
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(800);
      } catch {
        // Page may have unloaded between calls; ignore.
      }

      // Re-capture HTML AFTER the scroll simulation so the rendered DOM
      // reflects any nodes GTM injected mid-scroll.
      const renderedHtml = await page.content();

      // Real mobile signals via DOM measurement
      const mobileSignals = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const viewportWidth = window.innerWidth;
        const hasHorizontalScroll = docWidth > viewportWidth + 2;

        // Tap-target sampling: examine every link, button, and clickable role
        const clickable = Array.from(
          document.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]'),
        ) as HTMLElement[];
        let smallest = Infinity;
        for (const el of clickable) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue; // hidden / not laid out
          const min = Math.min(rect.width, rect.height);
          if (min < smallest) smallest = min;
        }
        const smallestTapTargetPx = smallest === Infinity ? null : Math.round(smallest);

        // Sample text font sizes
        const textNodes = Array.from(document.querySelectorAll('p, span, li, a, h1, h2, h3, h4, td')) as HTMLElement[];
        let smallCount = 0;
        for (const el of textNodes.slice(0, 200)) {
          const sz = parseFloat(window.getComputedStyle(el).fontSize);
          if (sz && sz < 12) smallCount++;
        }
        return { hasHorizontalScroll, smallestTapTargetPx, textSamplesUnder12px: smallCount };
      });

      // Upgrade 3 — read what the tracking stack registered on window:
      // dataLayer event names, the GTM container IDs, and the GA4 measurement
      // IDs. Defensive: dataLayer entries are arbitrary objects, so only
      // string event names and well-formed IDs are lifted out, never cloned.
      const trackingRuntime = await page
        .evaluate(() => {
          const events: string[] = [];
          const gtmIds: string[] = [];
          const ga4Ids: string[] = [];
          try {
            const dl = (window as unknown as { dataLayer?: unknown }).dataLayer;
            if (Array.isArray(dl)) {
              for (const entry of dl) {
                const ev = (entry as { event?: unknown })?.event;
                if (typeof ev === 'string') events.push(ev);
              }
            }
          } catch {
            // dataLayer absent or hostile — ignore
          }
          try {
            const gtm = (window as unknown as { google_tag_manager?: Record<string, unknown> })
              .google_tag_manager;
            if (gtm && typeof gtm === 'object') {
              for (const key of Object.keys(gtm)) {
                if (/^GTM-[A-Z0-9]+$/.test(key)) gtmIds.push(key);
                else if (/^G-[A-Z0-9]+$/.test(key)) ga4Ids.push(key);
              }
            }
          } catch {
            // google_tag_manager absent — ignore
          }
          return { dataLayerEvents: events, gtmContainerIds: gtmIds, ga4MeasurementIds: ga4Ids };
        })
        .catch(() => ({ dataLayerEvents: [], gtmContainerIds: [], ga4MeasurementIds: [] }));

      return {
        renderedHtml,
        networkHosts: [...networkHosts].sort(),
        scriptSrcs: [...scriptSrcs].sort(),
        mobile: {
          hasHorizontalScroll: mobileSignals.hasHorizontalScroll,
          smallestTapTargetPx: mobileSignals.smallestTapTargetPx,
          textSamplesUnder12px: mobileSignals.textSamplesUnder12px,
          viewport: '390x844' as const,
        },
        tracking: {
          beaconUrls: [...beaconUrls].sort(),
          dataLayerEvents: [...new Set(trackingRuntime.dataLayerEvents)].sort(),
          gtmContainerIds: [...new Set(trackingRuntime.gtmContainerIds)].sort(),
          ga4MeasurementIds: [...new Set(trackingRuntime.ga4MeasurementIds)].sort(),
        },
        durationMs: Date.now() - started,
      };
    } catch (e) {
      console.error('[audit/headless] failed', e);
      return null;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  })();

  return Promise.race([work, outerTimer]);
}

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
import { chromium as playwright, type Page } from 'playwright-core';
import { isTrackingHost, type HeadlessTrackingCapture } from './tracking';
import { pickPrimaryCta, type CtaCandidate, type ConversionPathResult } from './conversion-path';

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
  // Upgrade 4 — conversion-path trace. The primary CTA was clicked in the real
  // browser to see how many clicks reach a submittable form. Shape in ./conversion-path.
  conversionPath: ConversionPathResult;
  durationMs: number;
}

// Wave 2 audits exposed how thin 45s was for heavy enterprise / real-estate
// sites - 60s lets the page actually finish settling before scroll simulation.
// Vercel's default function timeout is 60s on Pro, so this is the hard ceiling.
const HEADLESS_TIMEOUT_MS = 60000;
const NAV_TIMEOUT_MS = 20000;
// Trace budget covers homepage + up to 2 deep-page escalations.
// Each trace = (enumerate + click + settle) ~3s; deep nav = ~2s. Worst case
// 3 + 2 + 3 + 2 + 3 = 13s. Cap at 15s for headroom.
const TRACE_TIMEOUT_MS = 15000;

// --- Upgrade 4: conversion-path trace -------------------------------------

// A submittable form is in reach if a visible <form> with a real input sits in
// the page, or a known form-embed iframe is present (HubSpot, Typeform, etc.).
async function hasSubmittableForm(page: Page): Promise<boolean> {
  const inDom = await page
    .evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form'));
      return forms.some((f) => {
        const r = f.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) return false;
        return !!f.querySelector('input:not([type=hidden]), textarea');
      });
    })
    .catch(() => false);
  if (inDom) return true;
  return page
    .frames()
    .some((f) =>
      /hsforms\.|typeform\.com|jotform\.|tally\.so|forms\.google|formstack|wufoo/i.test(f.url()),
    );
}

// Enumerate the page's clickable elements, tagging each with a data attribute
// so the chosen one can be re-located for the click.
async function enumerateCtas(page: Page): Promise<CtaCandidate[]> {
  return page
    .evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button'));
      const vh = window.innerHeight;
      const out: Array<{
        index: number;
        text: string;
        tag: 'a' | 'button';
        classId: string;
        href: string | null;
        area: number;
        aboveFold: boolean;
      }> = [];
      let idx = 0;
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        el.setAttribute('data-rivett-cta', String(idx));
        out.push({
          index: idx,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
          tag: el.tagName === 'BUTTON' ? 'button' : 'a',
          classId: (
            (el.getAttribute('class') || '') +
            ' ' +
            (el.getAttribute('id') || '')
          ).toLowerCase(),
          href: el.getAttribute('href'),
          area: Math.round(rect.width * rect.height),
          aboveFold: rect.top >= 0 && rect.top < vh,
        });
        idx++;
        if (idx >= 150) break;
      }
      return out;
    })
    .catch(() => [] as CtaCandidate[]);
}

// Upgrade 10 - consent-aware tracking measurement. CMP banners gate pixels
// behind user consent (Google Consent Mode, IAB TCF, OneTrust integrations
// with Meta Pixel). Without accepting the banner the static + headless scan
// reports "present, not firing" on every consent-gated site - which is most
// EU/UK sites and a growing share of US ones.
//
// Strategy: try explicit CMP "accept all" selectors first (fast, reliable,
// targets the well-known providers), then fall back to text-pattern matching
// for unknown CMPs. The fallback explicitly excludes Reject/Decline buttons
// so a site offering both "Accept all" and "Reject all" doesn't get its
// rejection clicked.
//
// Returns true when a dismissal was performed so the caller can adjust
// observation timing - consent-gated scripts need a beat to boot.

// Common CMP "accept all" selectors. These are stable across CMP versions
// and target the buttons that grant full pixel consent (not "only essential").
const CMP_ACCEPT_SELECTORS = [
  '#onetrust-accept-btn-handler', // OneTrust (most common enterprise CMP)
  '#CybotCookiebotDialogBodyButtonAccept', // Cookiebot
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', // Cookiebot variant
  '.iubenda-cs-accept-btn', // Iubenda
  '[data-testid="uc-accept-all-button"]', // Usercentrics
  '#axeptio_btn_acceptAll', // Axeptio
  '#cookiescript_accept', // Cookie-Script
  '.fc-cta-consent', // Funding Choices (Google)
  '#hs-eu-confirmation-button', // HubSpot
];

// Pure text-pattern matcher. Returns true when the given button text reads
// as "accept consent" - exported so its corpus can be unit-tested without
// spinning up a real browser. Hard-rejects rejection variants so a "Reject
// all" button never gets clicked even when its text contains "all".
export function isConsentAcceptText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length === 0 || t.length > 60) return false;
  // Explicit reject - never click these even if they incidentally contain
  // an "accept"-shaped word.
  if (/\b(reject|decline|deny|opt[\s-]?out|refuse|disagree)\b/i.test(t)) return false;
  // Accept variants - word-boundaries on common consent verbs.
  return /\b(accept|agree|allow|got it|i'?m ok|continue|confirm|allow all|accept all|i understand)\b/i.test(
    t,
  );
}

async function dismissCookieBanner(page: Page): Promise<boolean> {
  // Try explicit CMP selectors first - fastest path. Short timeout per
  // selector so a no-match doesn't add measurable latency to sites without
  // a banner. Total worst case ~3s if every selector misses.
  for (const sel of CMP_ACCEPT_SELECTORS) {
    const clicked = await page
      .click(sel, { timeout: 300 })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      // Bumped from 400ms to 1000ms - consent-gated tracking scripts
      // (Meta Pixel via consent mode, GA4 with consent_default, LinkedIn
      // Insight via consent integration) need 500-800ms to boot after the
      // CMP fires its consent-update event. 400ms missed most of them.
      await page.waitForTimeout(1000).catch(() => {});
      return true;
    }
  }

  // Fallback - text-pattern scan for unknown CMPs. Single page.evaluate so
  // the loop runs in one IPC hop. Best-effort, swallows errors.
  try {
    const clicked = await page.evaluate(
      ({ acceptPattern, rejectPattern }) => {
        const buttons = Array.from(
          document.querySelectorAll('button, a, [role="button"], [onclick]'),
        );
        const acceptRe = new RegExp(acceptPattern, 'i');
        const rejectRe = new RegExp(rejectPattern, 'i');
        for (const b of buttons) {
          const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length === 0 || t.length > 60) continue;
          if (rejectRe.test(t)) continue;
          if (acceptRe.test(t)) {
            (b as HTMLElement).click();
            return true;
          }
        }
        return false;
      },
      {
        acceptPattern:
          "\\b(accept|agree|allow|got it|i'?m ok|continue|confirm|allow all|accept all|i understand)\\b",
        rejectPattern: '\\b(reject|decline|deny|opt[\\s-]?out|refuse|disagree)\\b',
      },
    );
    if (clicked) {
      await page.waitForTimeout(1000).catch(() => {});
      return true;
    }
  } catch {
    // best effort - banner could be in a shadow DOM or iframe we can't reach.
    // The downstream code handles undismissed banners by reporting tracking
    // as "present, not firing" - honest, not silent failure.
  }
  return false;
}

// Path patterns for the deep-page escalation when the homepage trace returns
// no usable signal. Money > contact > about by intent strength. Mirrors the
// crawl module's discovery vocabulary so the two layers stay aligned.
const DEEP_PAGE_PATTERNS: { role: 'money' | 'contact' | 'about'; re: RegExp }[] = [
  {
    role: 'money',
    re: /[/-](pricing|plans|services|products|solutions|what-we-do|packages|shop|collections?)([/-]|$)/i,
  },
  {
    role: 'contact',
    re: /[/-](contact|contact-us|get-in-touch|reach-us|enquiries|inquiries|book)([/-]|$)/i,
  },
  {
    role: 'about',
    re: /[/-](about|about-us|company|our-story|who-we-are|team|meet-the-team)([/-]|$)/i,
  },
];

// Discover deep pages on the currently-loaded page. Same-origin only, asset
// extensions filtered, money > contact > about. Returns at most one URL per
// role, in escalation priority order.
async function discoverDeepPages(page: Page, origin: string): Promise<string[]> {
  const hrefs = await page
    .evaluate(() => {
      const out: string[] = [];
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      for (const a of anchors) {
        try {
          out.push(new URL(a.href, location.href).toString());
        } catch {
          // unparseable href - skip
        }
      }
      return out;
    })
    .catch(() => [] as string[]);

  const ASSET_EXT = /\.(jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|pdf|zip|mp4|webm|woff2?|ttf)$/i;
  const seen = new Map<'money' | 'contact' | 'about', string>();
  for (const href of hrefs) {
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (ASSET_EXT.test(u.pathname)) continue;
    const path = u.pathname.replace(/\/+$/, '');
    if (path === '' || path === '/') continue;
    for (const { role, re } of DEEP_PAGE_PATTERNS) {
      if (seen.has(role)) continue;
      if (re.test(path)) {
        seen.set(role, u.toString());
        break;
      }
    }
    if (seen.size === DEEP_PAGE_PATTERNS.length) break;
  }
  return DEEP_PAGE_PATTERNS.map((p) => seen.get(p.role)).filter((x): x is string => !!x);
}

// Trace the conversion path: find the primary CTA, click it, and see how many
// clicks it takes to reach a submittable form. Heavily guarded - interactive
// automation on arbitrary sites fails in many ways, and an honest
// "trace-failed" beats a wrong answer.
async function traceConversionPath(page: Page): Promise<ConversionPathResult> {
  try {
    const candidates = await enumerateCtas(page);
    const primary = pickPrimaryCta(candidates);

    if (await hasSubmittableForm(page)) {
      return { primaryCtaText: primary?.text ?? null, outcome: 'form-on-homepage', clicksToForm: 0 };
    }
    if (!primary) {
      return { primaryCtaText: null, outcome: 'no-cta', clicksToForm: null };
    }

    await dismissCookieBanner(page);
    const clicked = await page
      .click(`[data-rivett-cta="${primary.index}"]`, { timeout: 3500 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      return { primaryCtaText: primary.text, outcome: 'trace-failed', clicksToForm: null };
    }

    // Let the click settle - it may navigate, open a modal, or reveal a form.
    await page.waitForLoadState('domcontentloaded', { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(1000);
    const reached = await hasSubmittableForm(page);
    return {
      primaryCtaText: primary.text,
      outcome: reached ? 'form-after-click' : 'no-form-reached',
      clicksToForm: reached ? 1 : null,
    };
  } catch {
    return { primaryCtaText: null, outcome: 'trace-failed', clicksToForm: null };
  }
}

// Multi-page conversion-path orchestration. The homepage answers the question
// "does a cold visitor on the front door have a clear path" - but plenty of
// sites route the conversion off the homepage: the contact page has the form,
// the pricing page has the "Book a demo", the products listing is the funnel.
// When the homepage trace returns no-cta or no-form-reached we escalate to
// the money / contact / about pages (discovered from the current rendered nav)
// and return the FIRST page that produces a verified form-reached outcome.
// A homepage win stops escalation immediately; a deep-page win replaces the
// homepage result and tags the primary CTA with the page it came from.
async function tracePrimaryConversionPath(
  page: Page,
  origin: string,
): Promise<ConversionPathResult> {
  const homepage = await traceConversionPath(page);
  if (homepage.outcome === 'form-on-homepage' || homepage.outcome === 'form-after-click') {
    return homepage;
  }
  if (homepage.outcome !== 'no-cta' && homepage.outcome !== 'no-form-reached') {
    // trace-failed - the click handler errored. Escalating won't fix that.
    return homepage;
  }

  // Discover deep pages from the homepage we already loaded, before we navigate
  // away. Cap escalation at 2 pages to stay inside the headless time budget.
  const deepUrls = (await discoverDeepPages(page, origin)).slice(0, 2);
  if (deepUrls.length === 0) return homepage;

  for (const deepUrl of deepUrls) {
    try {
      const navigated = await page
        .goto(deepUrl, { waitUntil: 'domcontentloaded', timeout: 8000 })
        .then((r) => !!r && r.ok())
        .catch(() => false);
      if (!navigated) continue;
      await page.waitForTimeout(700);
      const deep = await traceConversionPath(page);
      if (deep.outcome === 'form-on-homepage' || deep.outcome === 'form-after-click') {
        // The "homepage" outcome name is preserved from the trace; the parent
        // headless result documents that the trace ran across pages.
        const where = new URL(deepUrl).pathname;
        return {
          ...deep,
          primaryCtaText: deep.primaryCtaText
            ? `${deep.primaryCtaText} (on ${where})`
            : `(on ${where})`,
        };
      }
    } catch {
      // Continue to the next candidate; a navigation failure on one deep page
      // shouldn't sink the whole escalation.
    }
  }
  return homepage;
}

// Run the headless pass with up to two retries on failure. Cold-start Chromium
// on Vercel can fail the first time (binary unmount, lambda CPU contention).
// Wave 2 audits showed heavy enterprise/real-estate sites need more retries -
// first call cold-starts and times out, second warms the binary, third does
// the actual work. Verified reads require headless, so we don't quietly skip.
export async function runHeadlessCheck(url: string): Promise<HeadlessResult | null> {
  const backoffsMs = [1500, 3000];
  let last: HeadlessResult | null = await runHeadlessOnce(url);
  for (let attempt = 0; attempt < backoffsMs.length && last === null; attempt++) {
    await new Promise((r) => setTimeout(r, backoffsMs[attempt]));
    last = await runHeadlessOnce(url);
  }
  if (last === null) {
    // Surfaced in the logs so a deploy-wide regression is visible. The audit
    // path checks for null and decides whether to fail the run; this is only
    // a marker.
    console.error('[audit/headless] all 3 attempts returned null for', url);
  }
  return last;
}

async function runHeadlessOnce(url: string): Promise<HeadlessResult | null> {
  const started = Date.now();

  // Hard outer cap: if the whole thing takes >HEADLESS_TIMEOUT_MS, bail.
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

      // Upgrade 10 - dismiss the consent banner BEFORE the settle period so
      // consent-gated pixels (Meta Pixel under consent mode, GA4 with
      // consent_default, LinkedIn Insight via TCF) can fire during the
      // observation window. Without this we report "present, not firing"
      // on every EU/UK site with a CMP - which is most of them. The trace
      // call later is idempotent (no banner to find on second pass).
      await dismissCookieBanner(page);

      // Brief settle for any post-networkidle late-fires (e.g., GTM hits after
      // initial idle, plus consent-update events that boot the rest of the
      // pixel stack). 800ms is a small bribe for the long tail of trackers.
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

      // Upgrade 4 — conversion-path trace. Runs LAST: it clicks the CTA, which
      // can navigate away, so every other capture must already be done. The
      // wrapper escalates to deep pages (money / contact / about) when the
      // homepage trace returns no-cta or no-form-reached, so a prospect whose
      // funnel runs through /pricing or /contact is not silently miscalled.
      const traceOrigin = new URL(url).origin;
      const conversionPath = await Promise.race<ConversionPathResult>([
        tracePrimaryConversionPath(page, traceOrigin),
        new Promise<ConversionPathResult>((resolve) =>
          setTimeout(
            () => resolve({ primaryCtaText: null, outcome: 'trace-failed', clicksToForm: null }),
            TRACE_TIMEOUT_MS,
          ),
        ),
      ]);

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
        conversionPath,
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

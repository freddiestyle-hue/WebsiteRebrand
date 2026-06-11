// Browserless /function payload — the v3 audit headless render, authored to run
// SERVER-SIDE on Browserless via their HTTPS /function API.
//
// Why this exists: the old path held a `playwright.connect()` WebSocket from the
// Vercel function to Browserless. That WS upgrade never completed reliably from
// Vercel's serverless network (connect hung → every audit timed out → 503). See
// headless-check.ts. The /function API is a plain HTTPS POST: Vercel sends this
// code, Browserless runs it on their box, and returns JSON. No WebSocket.
//
// SELF-CONTAINED BY REQUIREMENT: /function serializes this file's source and runs
// it in isolation, so it CANNOT import sibling modules. The pure logic below is
// duplicated from the TS source-of-truth and must stay behaviourally aligned:
//   - isTrackingHost / TRACKING_BEACON_HOSTS  ← tracking.ts
//   - pickPrimaryCta heuristics (HIGH_INTENT, CTA_CLASS, SKIP_HREF) ← conversion-path.ts
//   - CMP accept selectors + accept/reject patterns ← headless-check.ts
//   - DEEP_PAGE_PATTERNS ← headless-check.ts
//
// RUNTIME IS PUPPETEER, NOT PLAYWRIGHT. Differences from the old code:
//   - page.setViewport()/setUserAgent() instead of browser.newContext()
//   - goto waitUntil 'networkidle2' instead of 'networkidle'
//   - page.waitForNavigation() instead of page.waitForLoadState()
//   - no page.waitForTimeout(); a local sleep() helper is used
//   - clicks are issued in-page via evaluate() to dodge click-API differences
//
// Returns HeadlessResult minus durationMs (the caller stamps elapsed time).

export default async ({ page, context }) => {
  const url = context && context.url;
  // Keep the whole render inside Browserless's ~30s server-side cap (set by the
  // caller's &timeout) so it returns usable data instead of being killed.
  const NAV_TIMEOUT_MS = 15000;
  const TRACE_TIMEOUT_MS = 22000; // covers click + nav + up to ~13s of form-hydration polling
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- inlined from tracking.ts: which hosts are analytics/ads beacons ---
  const TRACKING_BEACON_HOSTS = [
    'facebook.com', 'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
    'px.ads.linkedin.com', 'analytics.tiktok.com', 'i.posthog.com', 'app.posthog.com',
  ];
  const isTrackingHost = (h) => {
    h = (h || '').toLowerCase();
    return TRACKING_BEACON_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  };

  // --- inlined from headless-check.ts: CMP "accept all" selectors + text patterns ---
  const CMP_ACCEPT_SELECTORS = [
    '#onetrust-accept-btn-handler', '#CybotCookiebotDialogBodyButtonAccept',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '.iubenda-cs-accept-btn',
    '[data-testid="uc-accept-all-button"]', '#axeptio_btn_acceptAll', '#cookiescript_accept',
    '.fc-cta-consent', '#hs-eu-confirmation-button',
  ];
  const ACCEPT_PATTERN = "\\b(accept|agree|allow|got it|i'?m ok|continue|confirm|allow all|accept all|i understand)\\b";
  const REJECT_PATTERN = '\\b(reject|decline|deny|opt[\\s-]?out|refuse|disagree)\\b';

  // --- inlined from headless-check.ts: deep-page escalation targets ---
  const DEEP_PAGE_PATTERNS = [
    { role: 'money', re: /[/-](pricing|plans|services|products|solutions|what-we-do|packages|shop|collections?)([/-]|$)/i },
    { role: 'contact', re: /[/-](contact|contact-us|get-in-touch|reach-us|enquiries|inquiries|book)([/-]|$)/i },
    { role: 'about', re: /[/-](about|about-us|company|our-story|who-we-are|team|meet-the-team)([/-]|$)/i },
  ];

  // --- inlined from conversion-path.ts: primary-CTA picker (pure) ---
  const HIGH_INTENT = /\b(get started|start (free|now|hiring)|free trial|try (it )?free|book (a |your )?(call|demo|consult\w*|appointment|tour|session|visit)|request (a |your )?(quote|demo|call|consult\w*|info|information|brochure|tour|callback)|get (a |your )?(quote|estimate|demo|callback|started|in touch)|schedule (a |your )?(call|demo|consult\w*|appointment|tour|visit)|talk to (us|sales|an expert|a specialist)|contact us|get in touch|book now|enquire|enquir(e|y)|inquire|claim your|sign up|join (now|today|free|the)|create (a |an |your )?account|register|apply (now|today|here)|see (our )?(pricing|plans|prices)|view (our )?(pricing|plans|prices)|get (the |a |our )?(app|free)|download|free (consultation|estimate|quote|assessment|audit)|find (out|your)|learn how|see how (it )?works|watch (a |the )?demo|shop( all| now| the| our)?|buy( now| it)?|add to (cart|bag)|order now|browse (our )?(collection|store|shop)|view (the |our |all )?(collection|products|store)|see (the |our )?(collection|catalog)|reserve (your |a )?(spot|seat|space|table)|donate( now| today)?|give (now|today)|volunteer|pledge|hire (now|today|top|talent|remote|offshore|with)|find talent|post a (job|role)|hire (a |an )?(va|developer|designer|assistant|team))\b/i;
  const CTA_CLASS = /\b(cta|btn-primary|primary-cta|hero-cta|btn-cta|action-btn|primary-button)\b/i;
  const SKIP_HREF = /^\s*(mailto:|tel:)/i;
  const pickPrimaryCta = (candidates) => {
    let best = null;
    for (const c of candidates) {
      const text = (c.text || '').trim();
      if (!text || text.length > 48) continue;
      if (c.href !== null && SKIP_HREF.test(c.href)) continue;
      const hiText = HIGH_INTENT.test(text);
      const ctaClass = CTA_CLASS.test(c.classId);
      if (!hiText && !ctaClass) continue;
      let score = 0;
      if (hiText) score += 4;
      if (ctaClass) score += 2;
      if (c.aboveFold) score += 2;
      if (c.tag === 'button') score += 1;
      if (c.area >= 800) score += 1;
      if (best === null || score > best.score) best = { cand: c, score };
    }
    return best ? { index: best.cand.index, text: best.cand.text.trim() } : null;
  };

  // --- network capture (request events fire without interception) ---
  const networkHosts = new Set();
  const scriptSrcs = new Set();
  const beaconUrls = new Set();
  page.on('request', (req) => {
    try {
      const u = new URL(req.url());
      networkHosts.add(u.hostname);
      if (req.resourceType() === 'script') scriptSrcs.add(req.url());
      if (isTrackingHost(u.hostname)) beaconUrls.add(req.url());
    } catch (e) {
      // unparseable URL — ignore
    }
  });

  // --- mobile emulation (390x844 iPhone) ---
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  );

  // --- navigate (capture what loaded even on timeout) ---
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  } catch (e) {
    // timeout/partial load is fine; we measure whatever rendered
  }

  // --- CMP dismissal: explicit selectors first, then a text-pattern fallback ---
  const dismissCookieBanner = async () => {
    for (const sel of CMP_ACCEPT_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click().catch(() => {});
          await sleep(1000);
          return true;
        }
      } catch (e) {
        // selector engine hiccup — keep trying
      }
    }
    try {
      const clicked = await page.evaluate(
        (acceptPattern, rejectPattern) => {
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"], [onclick]'));
          const acceptRe = new RegExp(acceptPattern, 'i');
          const rejectRe = new RegExp(rejectPattern, 'i');
          for (const b of buttons) {
            const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
            if (t.length === 0 || t.length > 60) continue;
            if (rejectRe.test(t)) continue;
            if (acceptRe.test(t)) {
              b.click();
              return true;
            }
          }
          return false;
        },
        ACCEPT_PATTERN,
        REJECT_PATTERN,
      );
      if (clicked) {
        await sleep(1000);
        return true;
      }
    } catch (e) {
      // banner may be in shadow DOM / cross-origin iframe — best effort
    }
    return false;
  };
  await dismissCookieBanner();

  await sleep(800);

  // --- scroll simulation to trigger scroll-gated pixels, then capture HTML ---
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);
  } catch (e) {
    // page may have unloaded between calls — ignore
  }

  const renderedHtml = await page.content();

  // --- real mobile signals via DOM measurement ---
  const mobile = await page
    .evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const viewportWidth = window.innerWidth;
      const hasHorizontalScroll = docWidth > viewportWidth + 2;
      const clickable = Array.from(
        document.querySelectorAll('a, button, [role="button"], [onclick], input[type="submit"], input[type="button"]'),
      );
      let smallest = Infinity;
      for (const el of clickable) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const min = Math.min(rect.width, rect.height);
        if (min < smallest) smallest = min;
      }
      const smallestTapTargetPx = smallest === Infinity ? null : Math.round(smallest);
      const textNodes = Array.from(document.querySelectorAll('p, span, li, a, h1, h2, h3, h4, td'));
      let smallCount = 0;
      for (const el of textNodes.slice(0, 200)) {
        const sz = parseFloat(window.getComputedStyle(el).fontSize);
        if (sz && sz < 12) smallCount++;
      }
      return { hasHorizontalScroll, smallestTapTargetPx, textSamplesUnder12px: smallCount, viewport: '390x844' };
    })
    .catch(() => ({ hasHorizontalScroll: false, smallestTapTargetPx: null, textSamplesUnder12px: 0, viewport: '390x844' }));

  // --- tracking runtime: dataLayer events, GTM/GA4 IDs registered on window ---
  const trackingRuntime = await page
    .evaluate(() => {
      const events = [];
      const gtmIds = [];
      const ga4Ids = [];
      try {
        const dl = window.dataLayer;
        if (Array.isArray(dl)) {
          for (const entry of dl) {
            const ev = entry && entry.event;
            if (typeof ev === 'string') events.push(ev);
          }
        }
      } catch (e) {
        // dataLayer absent or hostile
      }
      try {
        const gtm = window.google_tag_manager;
        if (gtm && typeof gtm === 'object') {
          for (const key of Object.keys(gtm)) {
            if (/^GTM-[A-Z0-9]+$/.test(key)) gtmIds.push(key);
            else if (/^G-[A-Z0-9]+$/.test(key)) ga4Ids.push(key);
          }
        }
      } catch (e) {
        // google_tag_manager absent
      }
      return { dataLayerEvents: events, gtmContainerIds: gtmIds, ga4MeasurementIds: ga4Ids };
    })
    .catch(() => ({ dataLayerEvents: [], gtmContainerIds: [], ga4MeasurementIds: [] }));

  // --- conversion-path trace helpers (Puppeteer) ---
  const hasSubmittableForm = async () => {
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
      .some((f) => /hsforms\.|typeform\.com|jotform\.|tally\.so|forms\.google|formstack|wufoo/i.test(f.url()));
  };

  const enumerateCtas = async () =>
    page
      .evaluate(() => {
        const els = Array.from(document.querySelectorAll('a, button'));
        const vh = window.innerHeight;
        const out = [];
        let idx = 0;
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          el.setAttribute('data-rivett-cta', String(idx));
          out.push({
            index: idx,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            tag: el.tagName === 'BUTTON' ? 'button' : 'a',
            classId: ((el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '')).toLowerCase(),
            href: el.getAttribute('href'),
            area: Math.round(rect.width * rect.height),
            aboveFold: rect.top >= 0 && rect.top < vh,
          });
          idx++;
          if (idx >= 150) break;
        }
        return out;
      })
      .catch(() => []);

  const traceConversionPath = async () => {
    try {
      const candidates = await enumerateCtas();
      const primary = pickPrimaryCta(candidates);
      // Rendered-DOM above-the-fold CTA truth - the static regex cannot see
      // CTAs whose text renders as per-character animated spans; innerText
      // here collapses them. Mirrors hasAboveFoldCta in conversion-path.ts.
      const ctaAboveFold = candidates.some(
        (c) =>
          c.aboveFold &&
          !!c.text.trim() &&
          c.text.length <= 48 &&
          !(c.href !== null && /^\s*(mailto:|tel:)/i.test(c.href)) &&
          (HIGH_INTENT.test(c.text) || CTA_CLASS.test(c.classId))
      );
      if (await hasSubmittableForm()) {
        return { primaryCtaText: primary ? primary.text : null, outcome: 'form-on-homepage', clicksToForm: 0, ctaAboveFold };
      }
      if (!primary) return { primaryCtaText: null, outcome: 'no-cta', clicksToForm: null, ctaAboveFold };
      await dismissCookieBanner();
      const clicked = await page
        .evaluate((idx) => {
          const el = document.querySelector('[data-rivett-cta="' + idx + '"]');
          if (!el) return false;
          el.click();
          return true;
        }, primary.index)
        .catch(() => false);
      if (!clicked) return { primaryCtaText: primary.text, outcome: 'trace-failed', clicksToForm: null, ctaAboveFold };
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2500 }).catch(() => {});
      // Poll for the form instead of a single check: JS-embedded forms
      // (HubSpot et al) on slow pages hydrate seconds after navigation -
      // somewhere.com's /form/contact took ~8s after a completed nav, and the
      // nav itself can eat seconds on a 13.7s-LCP site. Early-exits the
      // moment the form appears, so fast sites pay one 1s tick.
      let reached = false;
      for (let i = 0; i < 13 && !reached; i++) {
        await sleep(1000);
        reached = await hasSubmittableForm();
      }
      return {
        primaryCtaText: primary.text,
        outcome: reached ? 'form-after-click' : 'no-form-reached',
        clicksToForm: reached ? 1 : null,
        ctaAboveFold,
      };
    } catch (e) {
      return { primaryCtaText: null, outcome: 'trace-failed', clicksToForm: null };
    }
  };

  const discoverDeepPages = async (origin) => {
    const hrefs = await page
      .evaluate(() => {
        const out = [];
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          try {
            out.push(new URL(a.href, location.href).toString());
          } catch (e) {
            // unparseable href
          }
        }
        return out;
      })
      .catch(() => []);
    const ASSET_EXT = /\.(jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|pdf|zip|mp4|webm|woff2?|ttf)$/i;
    const seen = new Map();
    for (const href of hrefs) {
      let u;
      try {
        u = new URL(href);
      } catch (e) {
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
    return DEEP_PAGE_PATTERNS.map((p) => seen.get(p.role)).filter((x) => !!x);
  };

  const tracePrimaryConversionPath = async () => {
    const origin = new URL(url).origin;
    const homepage = await traceConversionPath();
    if (homepage.outcome === 'form-on-homepage' || homepage.outcome === 'form-after-click') return homepage;
    if (homepage.outcome !== 'no-cta' && homepage.outcome !== 'no-form-reached') return homepage;
    const deepUrls = (await discoverDeepPages(origin)).slice(0, 2);
    if (deepUrls.length === 0) return homepage;
    for (const deepUrl of deepUrls) {
      try {
        const resp = await page.goto(deepUrl, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
        if (!resp || !resp.ok()) continue;
        await sleep(700);
        const deep = await traceConversionPath();
        if (deep.outcome === 'form-on-homepage' || deep.outcome === 'form-after-click') {
          const where = new URL(deepUrl).pathname;
          return {
            ...deep,
            primaryCtaText: deep.primaryCtaText ? deep.primaryCtaText + ' (on ' + where + ')' : '(on ' + where + ')',
          };
        }
      } catch (e) {
        // a deep-page failure shouldn't sink the escalation
      }
    }
    return homepage;
  };

  // Runs LAST: it clicks/navigates, which can move the page. Any failure or
  // overrun degrades to 'trace-failed' so it never sinks the core render.
  let conversionPath = { primaryCtaText: null, outcome: 'trace-failed', clicksToForm: null };
  try {
    conversionPath = await Promise.race([
      tracePrimaryConversionPath(),
      new Promise((resolve) =>
        setTimeout(() => resolve({ primaryCtaText: null, outcome: 'trace-failed', clicksToForm: null }), TRACE_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    conversionPath = { primaryCtaText: null, outcome: 'trace-failed', clicksToForm: null };
  }

  return {
    data: {
      renderedHtml,
      networkHosts: [...networkHosts],
      scriptSrcs: [...scriptSrcs],
      mobile,
      tracking: {
        beaconUrls: [...beaconUrls].sort(),
        dataLayerEvents: [...new Set(trackingRuntime.dataLayerEvents)].sort(),
        gtmContainerIds: [...new Set(trackingRuntime.gtmContainerIds)].sort(),
        ga4MeasurementIds: [...new Set(trackingRuntime.ga4MeasurementIds)].sort(),
      },
      conversionPath,
    },
    type: 'application/json',
  };
};

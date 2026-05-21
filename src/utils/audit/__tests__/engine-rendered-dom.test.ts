import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAudit, type CheckResult } from '../engine';

/**
 * Upgrade 2 — rendered-DOM backbone.
 *
 * runAudit now accepts an optional renderedHtml (the headless-rendered,
 * post-JS DOM). When supplied, every homepage-derived check parses it
 * instead of the static fetch. These tests prove the false-negative class
 * the static-only scan suffered from is fixed: a form and Organization
 * schema that a framework injects after hydration are invisible to the
 * static HTML but caught in the rendered DOM.
 *
 * runAudit does network I/O (homepage + robots/sitemap/llms), so fetch is
 * stubbed with real Response objects — the SSRF-guarded safeFetch path
 * runs unchanged.
 */

// A JS-rendered SPA shell. The server sends an empty <div id="root">; the
// form and the Organization JSON-LD only exist after the framework runs.
const STATIC_SHELL = `<!doctype html><html><head><title>Acme</title>
<meta property="og:type" content="website" /></head>
<body><div id="root"></div></body></html>`;

// The same page after JS runs — what a real browser, and a real visitor, sees.
const RENDERED_DOM = `<!doctype html><html><head><title>Acme</title>
<meta property="og:type" content="website" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"https://acme.example"}</script>
</head><body><div id="root">
<form action="/contact" method="post"><input name="email" /><button>Send</button></form>
</div></body></html>`;

const ANCILLARY_RE = /\/(robots\.txt|sitemap[^/]*\.xml|llms\.txt|llms-full\.txt)$/i;

function mockFetch(homepageBody: string, opts: { homepageFails?: boolean } = {}) {
  return vi.fn(async (input: unknown) => {
    const u = String(input);
    if (ANCILLARY_RE.test(u)) return new Response('not found', { status: 404 });
    if (opts.homepageFails) return new Response('blocked by WAF', { status: 403 });
    return new Response(homepageBody, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  });
}

function check(checks: CheckResult[], id: string): CheckResult {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`check '${id}' not in result`);
  return c;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runAudit — rendered-DOM backbone (Upgrade 2)', () => {
  it('static-only scan false-negatives on a JS-injected form and schema', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL));
    const r = await runAudit('https://acme.example');
    expect(r.error).toBeUndefined();
    expect(check(r.checks, 'conversion-form-on-page').passed).toBe(false);
    expect(check(r.checks, 'org-schema').passed).toBe(false);
  });

  it('rendered DOM catches the same form and schema the static scan missed', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL));
    const r = await runAudit('https://acme.example', { renderedHtml: RENDERED_DOM });
    expect(r.error).toBeUndefined();
    expect(check(r.checks, 'conversion-form-on-page').passed).toBe(true);
    expect(check(r.checks, 'org-schema').passed).toBe(true);
  });

  it('empty or whitespace renderedHtml falls back to the static fetch', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL));
    const empty = await runAudit('https://acme.example', { renderedHtml: '' });
    const blank = await runAudit('https://acme.example', { renderedHtml: '   ' });
    expect(check(empty.checks, 'conversion-form-on-page').passed).toBe(false);
    expect(check(blank.checks, 'conversion-form-on-page').passed).toBe(false);
  });

  it('audits the rendered DOM even when a WAF blocks the static fetch', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL, { homepageFails: true }));
    const r = await runAudit('https://acme.example', { renderedHtml: RENDERED_DOM });
    expect(r.error).toBeUndefined();
    expect(check(r.checks, 'conversion-form-on-page').passed).toBe(true);
    // Static failed, so homepageHtml falls back to the rendered DOM.
    expect(r.homepageHtml).toBe(RENDERED_DOM);
  });

  it('errors only when the static fetch fails and no rendered DOM is given', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL, { homepageFails: true }));
    const r = await runAudit('https://acme.example');
    expect(r.error).toBeTruthy();
    expect(r.checks).toHaveLength(0);
  });

  it('ancillary checks and homepageHtml are unaffected by renderedHtml', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL));
    const staticRun = await runAudit('https://acme.example');
    const renderedRun = await runAudit('https://acme.example', { renderedHtml: RENDERED_DOM });
    // Sitemap and robots read their own fetches, not the homepage HTML, so
    // they resolve identically whether or not a rendered DOM is supplied.
    expect(check(renderedRun.checks, 'sitemap').passed).toBe(
      check(staticRun.checks, 'sitemap').passed,
    );
    expect(check(renderedRun.checks, 'robots').passed).toBe(
      check(staticRun.checks, 'robots').passed,
    );
    // When the static fetch succeeds, homepageHtml stays the static HTML.
    expect(renderedRun.homepageHtml).toBe(STATIC_SHELL);
  });
});

describe('runAudit — tracking measurement (Upgrade 3)', () => {
  it('reports a Meta event observed via the headless capture, even when the static HTML has no pixel', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL));
    const r = await runAudit('https://acme.example', {
      headlessTracking: {
        beaconUrls: ['https://www.facebook.com/tr/?id=1&ev=Lead'],
        dataLayerEvents: [],
        gtmContainerIds: [],
        ga4MeasurementIds: [],
      },
    });
    const meta = check(r.checks, 'tracking-meta-pixel');
    expect(meta.passed).toBe(true);
    expect(meta.finding).toContain('Lead');
  });

  it('without a headless capture, tracking falls back to static presence', async () => {
    vi.stubGlobal('fetch', mockFetch(STATIC_SHELL));
    const r = await runAudit('https://acme.example');
    // STATIC_SHELL carries no tracking code, so every tracking check fails.
    expect(check(r.checks, 'tracking-meta-pixel').passed).toBe(false);
    expect(check(r.checks, 'tracking-ga4').passed).toBe(false);
  });
});

describe('runAudit — multi-page crawl (Upgrade 1)', () => {
  // Homepage with a nav link to /contact but no form of its own.
  const HOME_WITH_NAV = `<!doctype html><html><head><title>Acme</title></head>
<body><nav><a href="/contact">Contact</a></nav><div id="root"></div></body></html>`;
  // The contact page is where the form lives.
  const CONTACT_PAGE = `<!doctype html><html><body>
<form action="/submit"><input name="email" /><button>Send</button></form></body></html>`;

  function crawlMockFetch() {
    return vi.fn(async (input: unknown) => {
      const u = String(input);
      if (/\/contact$/.test(u)) {
        return new Response(CONTACT_PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (ANCILLARY_RE.test(u)) return new Response('not found', { status: 404 });
      return new Response(HOME_WITH_NAV, { status: 200, headers: { 'content-type': 'text/html' } });
    });
  }

  it('judges conversion across the crawled pages: a form on /contact counts', async () => {
    vi.stubGlobal('fetch', crawlMockFetch());
    const r = await runAudit('https://acme.example', { crawl: true });
    const form = check(r.checks, 'conversion-form-on-page');
    expect(form.passed).toBe(true);
    expect(form.evidence).toContain('contact');
    expect(r.crawledPages?.some((p) => p.role === 'contact' && p.hasForm)).toBe(true);
  });

  it('without the crawl opt, conversion stays homepage-only', async () => {
    vi.stubGlobal('fetch', crawlMockFetch());
    const r = await runAudit('https://acme.example');
    // The homepage has no form and the crawl did not run, so it fails.
    expect(check(r.checks, 'conversion-form-on-page').passed).toBe(false);
    expect(r.crawledPages).toEqual([]);
  });
});

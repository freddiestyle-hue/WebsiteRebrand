import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  discoverKeyPages,
  detectConversionSignals,
  crawlPages,
  countFormFields,
  type DiscoveredPage,
  type PageRole,
} from '../crawl';

/**
 * Upgrade 1 - multi-page crawl. Tests for discoverKeyPages: the pure
 * classification that turns a homepage's nav links + the sitemap into the
 * prospect's key pages (contact / money / about).
 */

const ORIGIN = 'https://acme.com';

const NAV_HTML = `<!doctype html><html><body>
<nav>
  <a href="/">Home</a>
  <a href="/services">Our Services</a>
  <a href="/about-us">About Us</a>
  <a href="/contact"><span>Contact</span></a>
  <a href="/blog">Blog</a>
  <a href="https://twitter.com/acme">Twitter</a>
  <a href="mailto:hi@acme.com">Email</a>
  <a href="/brochure.pdf">Download</a>
</nav></body></html>`;

function byRole(pages: DiscoveredPage[], role: PageRole): string | undefined {
  return pages.find((p) => p.role === role)?.url;
}

describe('discoverKeyPages', () => {
  it('finds contact, money, and about from homepage nav links', () => {
    const pages = discoverKeyPages(NAV_HTML, '', ORIGIN);
    expect(byRole(pages, 'money')).toBe('https://acme.com/services');
    expect(byRole(pages, 'about')).toBe('https://acme.com/about-us');
    expect(byRole(pages, 'contact')).toBe('https://acme.com/contact');
    expect(pages).toHaveLength(3);
  });

  it('ignores the homepage, off-site links, mailto, and asset files', () => {
    const urls = discoverKeyPages(NAV_HTML, '', ORIGIN).map((p) => p.url);
    expect(urls).not.toContain('https://acme.com/');
    expect(urls.some((u) => u.includes('twitter.com'))).toBe(false);
    expect(urls.some((u) => u.includes('.pdf'))).toBe(false);
    expect(urls.some((u) => u.includes('/blog'))).toBe(false);
  });

  it('falls back to the sitemap when the nav has no key links', () => {
    const sitemap = `<urlset>
      <url><loc>https://acme.com/</loc></url>
      <url><loc>https://acme.com/pricing</loc></url>
      <url><loc>https://acme.com/contact-us</loc></url></urlset>`;
    const pages = discoverKeyPages('<html><body></body></html>', sitemap, ORIGIN);
    expect(byRole(pages, 'money')).toBe('https://acme.com/pricing');
    expect(byRole(pages, 'contact')).toBe('https://acme.com/contact-us');
  });

  it('prefers a nav link over a sitemap-only URL for the same role', () => {
    const sitemap = `<urlset><url><loc>https://acme.com/contact</loc></url></urlset>`;
    const nav = `<html><body><a href="/get-in-touch">Get in touch</a></body></html>`;
    const pages = discoverKeyPages(nav, sitemap, ORIGIN);
    expect(byRole(pages, 'contact')).toBe('https://acme.com/get-in-touch');
  });

  it('breaks ties toward the shorter, more canonical path', () => {
    const sitemap = `<urlset>
      <url><loc>https://acme.com/services/enterprise-plan</loc></url>
      <url><loc>https://acme.com/services</loc></url></urlset>`;
    const pages = discoverKeyPages('<html></html>', sitemap, ORIGIN);
    expect(byRole(pages, 'money')).toBe('https://acme.com/services');
  });

  it('crawls the prospect own origin only, not links off it', () => {
    const nav = `<html><body>
      <a href="https://competitor.com/pricing">Pricing</a>
      <a href="/contact">Contact</a></body></html>`;
    const pages = discoverKeyPages(nav, '', ORIGIN);
    expect(byRole(pages, 'money')).toBeUndefined();
    expect(byRole(pages, 'contact')).toBe('https://acme.com/contact');
  });

  it('returns nothing for empty input or an unparseable origin', () => {
    expect(discoverKeyPages('', '', ORIGIN)).toEqual([]);
    expect(discoverKeyPages(NAV_HTML, '', 'not-a-url')).toEqual([]);
  });

  // Upgrade 9 - lift page cap from 3 to 5. Sites with case-studies and
  // demo pages now get those checked too, surfacing forms and CTAs that
  // live outside the contact/money/about triad.
  it('discovers up to 5 key pages including case-studies and demo (Upgrade 9)', () => {
    const fullNav = `<!doctype html><html><body>
<nav>
  <a href="/services">Our Services</a>
  <a href="/about-us">About Us</a>
  <a href="/contact">Contact</a>
  <a href="/case-studies">Case Studies</a>
  <a href="/book-a-demo">Book a Demo</a>
</nav></body></html>`;
    const pages = discoverKeyPages(fullNav, '', ORIGIN);
    expect(pages).toHaveLength(5);
    expect(byRole(pages, 'money')).toBe('https://acme.com/services');
    expect(byRole(pages, 'about')).toBe('https://acme.com/about-us');
    expect(byRole(pages, 'contact')).toBe('https://acme.com/contact');
    expect(byRole(pages, 'case-studies')).toBe('https://acme.com/case-studies');
    expect(byRole(pages, 'demo')).toBe('https://acme.com/book-a-demo');
  });

  it('matches case-studies variations (customers, success-stories, testimonials)', () => {
    const nav = `<html><body>
      <a href="/customers">Our Customers</a></body></html>`;
    const pages = discoverKeyPages(nav, '', ORIGIN);
    expect(byRole(pages, 'case-studies')).toBe('https://acme.com/customers');
  });

  it('matches demo variations (free-trial, get-started, request-demo)', () => {
    const sitemap = `<urlset>
      <url><loc>https://acme.com/free-trial</loc></url></urlset>`;
    const pages = discoverKeyPages('<html></html>', sitemap, ORIGIN);
    expect(byRole(pages, 'demo')).toBe('https://acme.com/free-trial');
  });

  it('roles compete money-first - /services-demo claims money, not demo', () => {
    // Edge case: /services-demo matches money's "services" first. Order matters.
    const nav = `<html><body>
      <a href="/services-demo">Services Demo</a>
      <a href="/book-a-call">Book a call</a></body></html>`;
    const pages = discoverKeyPages(nav, '', ORIGIN);
    expect(byRole(pages, 'money')).toBe('https://acme.com/services-demo');
    expect(byRole(pages, 'demo')).toBe('https://acme.com/book-a-call');
  });
});

describe('countFormFields (Upgrade 9)', () => {
  it('returns zero counts when no form is present', () => {
    expect(countFormFields('<html><body><p>no form here</p></body></html>')).toEqual({
      total: 0,
      required: 0,
    });
  });

  it('counts visible inputs but skips hidden/submit/button/reset/image', () => {
    const html = `<form>
      <input type="text" name="name" />
      <input type="email" name="email" />
      <input type="hidden" name="csrf" value="abc" />
      <input type="submit" value="Send" />
      <input type="button" value="Cancel" />
      <input type="reset" />
      <input type="image" src="/x.png" />
    </form>`;
    expect(countFormFields(html)).toEqual({ total: 2, required: 0 });
  });

  it('counts textareas and selects alongside inputs', () => {
    const html = `<form>
      <input type="text" name="name" />
      <select name="country"><option>UK</option></select>
      <textarea name="message"></textarea>
    </form>`;
    expect(countFormFields(html)).toEqual({ total: 3, required: 0 });
  });

  it('counts required attribute on inputs, textareas, and selects', () => {
    const html = `<form>
      <input type="text" name="name" required />
      <input type="email" name="email" required="required" />
      <textarea name="message" required></textarea>
      <select name="country"><option>UK</option></select>
    </form>`;
    expect(countFormFields(html)).toEqual({ total: 4, required: 3 });
  });

  it('only inspects the first form when multiple are present', () => {
    const html = `
      <form><input type="text" name="search" /></form>
      <form>
        <input type="email" name="email" required />
        <input type="text" name="company" required />
        <textarea name="message"></textarea>
      </form>`;
    // Only the first form (search box) is counted.
    expect(countFormFields(html)).toEqual({ total: 1, required: 0 });
  });

  it('returns zero when a form has no fillable fields (post-JS render expected)', () => {
    // Some sites render <form> with no inputs and inject fields via JS.
    // Static parse should report 0 - the engine.ts evidence builder
    // omits the "(N fields)" suffix to avoid misleading prospects.
    const html = `<form action="/x"><button type="submit">Send</button></form>`;
    expect(countFormFields(html)).toEqual({ total: 0, required: 0 });
  });
});

describe('detectConversionSignals', () => {
  it('detects a form', () => {
    expect(detectConversionSignals('<form action="/x"><input /></form>').hasForm).toBe(true);
  });
  it('detects a tel link and a scheduling link', () => {
    const s = detectConversionSignals(
      '<a href="tel:+1234567890">Call</a> <a href="https://calendly.com/acme">Book</a>',
    );
    expect(s.hasTelLink).toBe(true);
    expect(s.hasScheduling).toBe(true);
  });
  it('detects a chat widget', () => {
    expect(
      detectConversionSignals('<script src="https://widget.intercom.io/x.js"></script>')
        .hasChatWidget,
    ).toBe(true);
  });
  it('detects a prominent CTA in the hero', () => {
    expect(detectConversionSignals('<a class="hero-cta" href="/x">Book a call</a>').hasPromptCta).toBe(
      true,
    );
  });
  it('a bare page has no conversion signals', () => {
    const s = detectConversionSignals('<html><body><p>hello there</p></body></html>');
    expect(s.hasForm || s.hasTelLink || s.hasScheduling || s.hasChatWidget || s.hasPromptCta).toBe(
      false,
    );
  });
  // Upgrade 9 - field counts surface in the conversion signals so the engine
  // can enrich the D-06 cell evidence with "(N fields, M required)".
  it('returns formFieldCount and formRequiredCount alongside boolean signals', () => {
    const html = `<form>
      <input type="text" name="name" required />
      <input type="email" name="email" required />
      <textarea name="message"></textarea>
    </form>`;
    const s = detectConversionSignals(html);
    expect(s.hasForm).toBe(true);
    expect(s.formFieldCount).toBe(3);
    expect(s.formRequiredCount).toBe(2);
  });
  it('returns zero field counts when no form is present', () => {
    const s = detectConversionSignals('<html><body><p>nothing</p></body></html>');
    expect(s.formFieldCount).toBe(0);
    expect(s.formRequiredCount).toBe(0);
  });
});

function mockFetch(routes: Record<string, { status?: number; body?: string }>) {
  return vi.fn(async (input: unknown) => {
    const r = routes[String(input)];
    if (!r) return new Response('not found', { status: 404 });
    return new Response(r.body ?? '', {
      status: r.status ?? 200,
      headers: { 'content-type': 'text/html' },
    });
  });
}

describe('crawlPages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads conversion signals from each crawled page', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        'https://acme.com/contact': {
          body: '<html><body><form action="/x"><input /></form></body></html>',
        },
        'https://acme.com/pricing': {
          body: '<html><body><a class="cta-button" href="/y">Get started</a></body></html>',
        },
      }),
    );
    const result = await crawlPages([
      { url: 'https://acme.com/contact', role: 'contact' },
      { url: 'https://acme.com/pricing', role: 'money' },
    ]);
    const contact = result.pages.find((p) => p.role === 'contact');
    const money = result.pages.find((p) => p.role === 'money');
    expect(contact?.ok).toBe(true);
    expect(contact?.hasForm).toBe(true);
    expect(money?.hasPromptCta).toBe(true);
    expect(money?.hasForm).toBe(false);
  });

  it('flags a page that fails to fetch instead of dropping it', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const result = await crawlPages([{ url: 'https://acme.com/contact', role: 'contact' }]);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].ok).toBe(false);
    expect(result.pages[0].fetchError).toBeTruthy();
    expect(result.pages[0].hasForm).toBe(false);
  });

  it('returns an empty result for no pages', async () => {
    const result = await crawlPages([]);
    expect(result.pages).toEqual([]);
  });
});

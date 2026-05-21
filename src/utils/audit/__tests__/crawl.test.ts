import { describe, it, expect } from 'vitest';
import { discoverKeyPages, type DiscoveredPage, type PageRole } from '../crawl';

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
});

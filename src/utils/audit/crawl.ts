// Multi-page crawl (Upgrade 1). The audit used to read only the homepage,
// but a prospect's growth operation runs through more than `/`: the contact
// page, the money page (services / pricing / products), the about page.
//
// discoverKeyPages finds those from the homepage nav links and the sitemap.
// It is pure (no I/O) so it is unit-testable; the fetching lives in crawlPages.

export type PageRole = 'contact' | 'money' | 'about';

export interface DiscoveredPage {
  url: string;
  role: PageRole;
}

// Path and link-text keyword patterns per role. A match on the URL path is
// stronger evidence than a link-text match alone. Path keywords are bounded
// by `/` or `-` so `/our-services` and `/services` both hit `services`.
const ROLE_PATTERNS: Record<PageRole, { path: RegExp; text: RegExp }> = {
  contact: {
    path: /[/-](contact|contact-us|get-in-touch|reach-us|enquiries|inquiries)([/-]|$)/i,
    text: /\b(contact|get in touch|reach us)\b/i,
  },
  money: {
    path: /[/-](pricing|plans|services|products|solutions|what-we-do|packages)([/-]|$)/i,
    text: /\b(pricing|plans|services|products|solutions|what we do|packages)\b/i,
  },
  about: {
    path: /[/-](about|about-us|company|our-story|who-we-are|team|meet-the-team)([/-]|$)/i,
    text: /\b(about us|about|our story|who we are|our team)\b/i,
  },
};

// Hrefs that are never crawlable pages.
const SKIP_HREF = /^\s*(#|mailto:|tel:|javascript:|data:)/i;
const ASSET_EXT =
  /\.(jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|pdf|zip|mp4|webm|woff2?|ttf)$/i;

// Roles are resolved money-first: the money page is the most valuable, so if
// one URL could read as both money and about, money claims it.
const ROLE_ORDER: PageRole[] = ['money', 'contact', 'about'];

const MAX_SITEMAP_URLS = 300;

interface Candidate {
  url: string;
  path: string; // lowercased pathname
  text: string; // lowercased, tag-stripped link text ('' for sitemap entries)
  fromNav: boolean;
}

function normalize(href: string, origin: string): string | null {
  if (!href || SKIP_HREF.test(href)) return null;
  let u: URL;
  try {
    u = new URL(href, origin);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // Same origin only - we crawl the prospect's own site, not links off it.
  if (u.origin !== origin) return null;
  if (ASSET_EXT.test(u.pathname)) return null;
  u.hash = '';
  u.search = '';
  // The homepage itself is audited by the main flow, not the crawl.
  const path = u.pathname.replace(/\/+$/, '');
  if (path === '' || path === '/') return null;
  return u.toString();
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNavLinks(homepageHtml: string, origin: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(homepageHtml)) !== null) {
    const url = normalize(m[1], origin);
    if (!url) continue;
    out.push({
      url,
      path: new URL(url).pathname.toLowerCase(),
      text: stripTags(m[2]).toLowerCase().slice(0, 120),
      fromNav: true,
    });
  }
  return out;
}

function extractSitemapLinks(sitemapXml: string, origin: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = re.exec(sitemapXml)) !== null && seen < MAX_SITEMAP_URLS) {
    seen++;
    const url = normalize(m[1], origin);
    if (!url) continue;
    out.push({ url, path: new URL(url).pathname.toLowerCase(), text: '', fromNav: false });
  }
  return out;
}

function scoreFor(c: Candidate, role: PageRole): number {
  const { path, text } = ROLE_PATTERNS[role];
  let score = 0;
  if (path.test(c.path)) score += 2;
  if (c.text && text.test(c.text)) score += 1;
  if (score === 0) return 0;
  // A nav link is a stronger signal than a sitemap-only URL: it is a page
  // the operator chose to surface.
  if (c.fromNav) score += 1;
  return score;
}

function segCount(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/**
 * Discover the prospect's key pages from the homepage nav links and the
 * sitemap: the contact page, the money page (services/pricing), the about
 * page. Returns at most one URL per role (so at most three pages). Pure -
 * no network.
 */
export function discoverKeyPages(
  homepageHtml: string,
  sitemapXml: string,
  origin: string,
): DiscoveredPage[] {
  let normOrigin: string;
  try {
    normOrigin = new URL(origin).origin;
  } catch {
    return [];
  }
  const candidates = [
    ...extractNavLinks(homepageHtml || '', normOrigin),
    ...extractSitemapLinks(sitemapXml || '', normOrigin),
  ];

  const picked: DiscoveredPage[] = [];
  const usedUrls = new Set<string>();
  for (const role of ROLE_ORDER) {
    let best: Candidate | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      if (usedUrls.has(c.url)) continue;
      const s = scoreFor(c, role);
      if (s === 0) continue;
      // Higher score wins; ties break to the shorter path, which favours the
      // canonical page (/pricing over /pricing/enterprise-plan).
      if (
        s > bestScore ||
        (s === bestScore && best !== null && segCount(c.path) < segCount(best.path))
      ) {
        best = c;
        bestScore = s;
      }
    }
    if (best) {
      picked.push({ url: best.url, role });
      usedUrls.add(best.url);
    }
  }
  return picked;
}

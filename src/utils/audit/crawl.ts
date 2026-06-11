// Multi-page crawl (Upgrade 1). The audit used to read only the homepage,
// but a prospect's growth operation runs through more than `/`: the contact
// page, the money page (services / pricing / products), the about page.
//
// discoverKeyPages finds those from the homepage nav links and the sitemap.
// It is pure (no I/O) so it is unit-testable; the fetching lives in crawlPages.

export type PageRole = 'contact' | 'money' | 'about' | 'case-studies' | 'demo';

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
  // Upgrade 9 - lift page cap from 3 to 5. Case-studies and demo pages are the
  // two highest-conversion-signal pages outside contact/money/about. Adding
  // them lets the conversion-path check catch sites whose primary form lives
  // on /case-studies/{name} or /book-a-demo instead of /contact.
  'case-studies': {
    path: /[/-](case-stud(y|ies)|customers?|success-stor(y|ies)|customer-stor(y|ies)|testimonials|stories)([/-]|$)/i,
    text: /\b(case stud(y|ies)|customers?|success stories|customer stories|testimonials)\b/i,
  },
  demo: {
    path: /[/-](demo|book(-a)?-demo|request(-a)?-demo|free-trial|trial|start-(free|trial)|get-started|book(-a)?-call)([/-]|$)/i,
    text: /\b(book a demo|request a demo|free trial|start free|get started|book a call|see (a |it in )?action)\b/i,
  },
};

// Hrefs that are never crawlable pages.
const SKIP_HREF = /^\s*(#|mailto:|tel:|javascript:|data:)/i;
const ASSET_EXT =
  /\.(jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|pdf|zip|mp4|webm|woff2?|ttf)$/i;

// Roles are resolved money-first: the money page is the most valuable, so if
// one URL could read as both money and about, money claims it. Upgrade 9 -
// demo claims early (conversion-bearing), case-studies later (proof-bearing).
const ROLE_ORDER: PageRole[] = ['money', 'demo', 'contact', 'case-studies', 'about'];

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

// --- Crawl: read the discovered pages -------------------------------------

const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CRAWL_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Private / loopback ranges - never crawl these (SSRF guard).
const BLOCKED_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^0\./,
];
function isSafeHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return false;
  return !BLOCKED_IPV4.some((re) => re.test(h));
}

export interface ConversionSignals {
  hasForm: boolean;
  hasTelLink: boolean;
  hasScheduling: boolean;
  hasChatWidget: boolean;
  hasPromptCta: boolean;
  // Upgrade 9 - field-count introspection on the first <form> found. Surfaced
  // in the D-06 cell evidence so a prospect reads "form on homepage (7 fields,
  // 4 required)" instead of just "form present". 14-field beasts read very
  // differently from 2-field "name + email" lead gates.
  formFieldCount: number;
  formRequiredCount: number;
}

// Hidden-input or non-data input types that shouldn't count toward the
// prospect-facing field count. Buttons, submits, hidden tokens, and
// resets are plumbing the visitor never sees as "fields to fill".
const NON_VISIBLE_INPUT_TYPE = /type\s*=\s*["'](hidden|submit|button|reset|image)["']/i;

// Pure form-field counter. Inspects the FIRST <form> block in the HTML and
// counts visible inputs + textareas + selects. Stable on minified HTML.
// Returns {total: 0, required: 0} when no form is present.
export function countFormFields(html: string): { total: number; required: number } {
  const formMatch = html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) return { total: 0, required: 0 };
  const body = formMatch[1];

  const inputTags = body.match(/<input\b[^>]*>/gi) ?? [];
  const visibleInputs = inputTags.filter((t) => !NON_VISIBLE_INPUT_TYPE.test(t));
  const textareas = (body.match(/<textarea\b[^>]*>/gi) ?? []).length;
  const selects = (body.match(/<select\b[^>]*>/gi) ?? []).length;
  const total = visibleInputs.length + textareas + selects;

  // Count `required` attribute occurrences within input/textarea/select tags.
  // Bounded matcher: `required` must be a standalone attribute, not part of
  // a longer word like `required-by` (rare but possible).
  const fieldTags = body.match(/<(input|textarea|select)\b[^>]*>/gi) ?? [];
  const required = fieldTags.filter((t) => /\brequired\b(\s|=|>|\/)/i.test(t)).length;

  return { total, required };
}

// The conversion-path regexes, in one place. engine.ts checks these on the
// homepage; the crawl checks them on the other key pages so a form on
// /contact or a CTA on /pricing is no longer invisible to the audit.
export function detectConversionSignals(html: string): ConversionSignals {
  // Hero = the first stretch of BODY markup. Slicing from offset 0 made the
  // hero window pure <head> boilerplate on script-heavy builders (Webflow
  // heads alone run past 4000 chars - somewhere.com's "Start Hiring" header
  // CTA was invisible to this check until the slice anchored on <body>).
  const bodyStart = html.search(/<body\b[^>]*>/i);
  const heroText = bodyStart >= 0 ? html.slice(bodyStart, bodyStart + 8000) : html.slice(0, 4000);
  const fields = countFormFields(html);
  return {
    // A literal <form> tag, or a known JS form-embed loader. Embedded forms
    // (HubSpot, Typeform, Jotform...) inject the <form> at runtime, so the
    // static fetch sees only the loader script - which is still proof a form
    // lives on the page.
    hasForm:
      /<form\b[^>]*>/i.test(html) ||
      /(js\.hsforms\.net|hbspt\.forms\.create|embed\.typeform\.com|form\.jotform|jotfor\.ms|tally\.so\/embed|marketo\.com\/js\/forms2|go\.pardot\.com)/i.test(
        html,
      ),
    hasTelLink: /\bhref=["']tel:/i.test(html),
    hasScheduling:
      /(calendly\.com|cal\.com\/[a-z]|calendar\.app\.google|hubspot\.com\/meetings|chilipiper\.com|savvycal\.com|tidycal\.com)/i.test(
        html,
      ),
    hasChatWidget:
      /(intercom\.io\/messenger|widget\.intercom\.io|drift\.com|js\.driftt\.com|tawk\.to|crisp\.chat|chatwidget|hubspot\.com\/conversation)/i.test(
        html,
      ),
    hasPromptCta:
      /<(a|button)[^>]*\b(class|id)=["'][^"']*(cta|btn-primary|primary-cta|hero-cta|book|start|get-started|trial)/i.test(
        heroText,
      ) ||
      /<(a|button)[^>]*>([^<]*\b(get started|start free|start hiring|hire (now|talent|top)|find talent|book a (call|demo)|request (a )?(quote|demo)|schedule (a )?(call|demo)|talk to|contact us)\b)/i.test(
        heroText,
      ),
    formFieldCount: fields.total,
    formRequiredCount: fields.required,
  };
}

export interface CrawledPage extends ConversionSignals {
  url: string;
  role: PageRole;
  ok: boolean;
  fetchError?: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  durationMs: number;
}

const NO_SIGNALS: ConversionSignals = {
  hasForm: false,
  hasTelLink: false,
  hasScheduling: false,
  hasChatWidget: false,
  hasPromptCta: false,
  formFieldCount: 0,
  formRequiredCount: 0,
};

async function fetchPageHtml(
  url: string,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'unparseable URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported protocol' };
  }
  if (!isSafeHost(parsed.hostname)) {
    return { ok: false, reason: 'blocked host' };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      headers: { 'User-Agent': CRAWL_USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: 'no body' };
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return { ok: false, reason: 'response too large' };
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(bytes);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    return { ok: true, html: new TextDecoder('utf-8', { fatal: false }).decode(buf) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg.includes('abort') ? 'timeout' : msg };
  } finally {
    clearTimeout(t);
  }
}

async function crawlOne(page: DiscoveredPage): Promise<CrawledPage> {
  const res = await fetchPageHtml(page.url);
  if (!res.ok) {
    return { url: page.url, role: page.role, ok: false, fetchError: res.reason, ...NO_SIGNALS };
  }
  return { url: page.url, role: page.role, ok: true, ...detectConversionSignals(res.html) };
}

/**
 * Crawl the discovered key pages and read their conversion signals. One
 * static fetch per page, run in parallel, each guarded by its own timeout
 * and SSRF check. A page that fails to fetch still appears in the result,
 * flagged, so the audit can say it tried rather than silently dropping it.
 */
export async function crawlPages(pages: DiscoveredPage[]): Promise<CrawlResult> {
  const started = Date.now();
  if (pages.length === 0) return { pages: [], durationMs: 0 };
  const crawled = await Promise.all(pages.map(crawlOne));
  return { pages: crawled, durationMs: Date.now() - started };
}

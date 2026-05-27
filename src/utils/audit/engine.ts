// AEO audit engine. Fetches a target URL, runs checks, returns structured findings.
// Designed to run inside a Vercel Function within ~10s budget.

import {
  detectTracking,
  measureTracking,
  type HeadlessTrackingCapture,
  type PixelMeasurement,
} from './tracking';
import {
  discoverKeyPages,
  crawlPages,
  detectConversionSignals,
  type CrawledPage,
  type ConversionSignals,
  type PageRole,
} from './crawl';
import type { ConversionPathResult } from './conversion-path';

// Upgrade 7 - how far a finding can be trusted, especially a negative one.
//   verified     - confirmed present, or a real measurement, or an
//                  authoritative absence (a 404, a missing DNS record).
//                  Assertable as fact.
//   soft-absence - reports something absent, but the method false-negatives
//                  (HTML parse, regex, allowlist). Never assert the absence.
//   inferred     - a perception or model read, not a measurement. Frame as
//                  perception, never as fact.
export type ReliabilityTag = 'verified' | 'soft-absence' | 'inferred';

export interface CheckResult {
  id: string;
  category: 'crawl' | 'schema' | 'meta' | 'aeo' | 'tracking' | 'conversion';
  label: string;
  passed: boolean;
  weight: number;
  evidence: string;
  finding: string;
  // Upgrade 3 - for tracking checks, the structured measurement behind the
  // pass/fail (state + observed events). Absent on non-tracking checks.
  measurement?: PixelMeasurement;
  // Upgrade 7 - calibration tag the synthesis layer and LLM hero read so a
  // soft negative is never asserted as a hard fact.
  reliability: ReliabilityTag;
}

// A check before the reliability pass runs. runAudit builds these, then
// finalizes each into a CheckResult by computing its reliability tag.
export type DraftCheck = Omit<CheckResult, 'reliability'>;

export interface AuditResult {
  url: string;
  hostname: string;
  fetchedAt: string;
  durationMs: number;
  homepageHtml?: string;
  homepageHeaders?: Record<string, string>;
  checks: CheckResult[];
  scoreNumeric: number;
  scoreMax: number;
  scorePercent: number;
  band: 'invisible' | 'weak' | 'discoverable' | 'ready';
  bandLabel: string;
  bandKicker: string;
  verdict: {
    crawl: { grade: string; passed: number; total: number };
    schema: { grade: string; passed: number; total: number };
    aeo: { grade: string; passed: number; total: number };
    sendReady: { grade: string; passed: number; total: number };
  };
  // Upgrade 1 - the key pages crawled beyond the homepage (contact / money /
  // about) and what each carried. Empty when the crawl did not run.
  crawledPages?: CrawledPage[];
  error?: string;
}

const FETCH_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Real Chrome string. WAFs (Cloudflare, AWS WAF, Imperva) routinely block the
// previous custom 'RivettAEO/0.1' UA outright (herculesindustries.com returned 403).
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BLOCKED_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;
  if (BLOCKED_IPV4.some((re) => re.test(h))) return true;
  // Block IPv6 link-local / unique-local / loopback. Coarse but conservative.
  if (h.startsWith('[') && (h.includes(':fe8') || h.includes(':fc') || h.includes(':fd') || h === '[::1]')) return true;
  return false;
}

export function normalizeAuditUrl(raw: string): { url: string; hostname: string } | { error: string } {
  let input = (raw || '').trim();
  if (!input) return { error: 'No URL provided.' };
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { error: `URL could not be parsed. Try entering a bare domain like example.com.` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `Only http:// and https:// are supported.` };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { error: `Cannot audit this host. Private or loopback addresses are not allowed.` };
  }
  // Drop hash + most query (keep none — we always audit the bare URL surface)
  parsed.hash = '';
  return { url: parsed.toString(), hostname: parsed.hostname };
}

const MAX_REDIRECTS = 5;

async function safeFetch(url: string): Promise<{ ok: true; status: number; text: string; contentType: string; headers: Record<string, string> } | { ok: false; status: number; reason: string }> {
  // SSRF guard: if we let fetch follow redirects natively, the per-hop
  // hostname is never re-validated. An attacker submits attacker.com which
  // 302s to 169.254.169.254 (AWS IMDS) or any internal host and the audit
  // function ends up exfiltrating private metadata. Instead: drive
  // redirects manually, re-run normalizeAuditUrl on each Location header,
  // refuse any hop that lands on a blocked host.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let currentUrl = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*' },
        signal: controller.signal,
        redirect: 'manual',
      });

      const status = res.status;
      // Manual redirect: 3xx with Location header → re-validate and loop.
      if (status >= 300 && status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { ok: false, status, reason: `redirect ${status} with no Location header` };
        }
        // Resolve relative redirects against the current URL.
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          return { ok: false, status, reason: `unparseable redirect target: ${location}` };
        }
        const check = normalizeAuditUrl(next.toString());
        if ('error' in check) {
          return { ok: false, status, reason: `redirect blocked: ${check.error}` };
        }
        currentUrl = check.url;
        continue;
      }

      // Terminal response.
      const contentType = res.headers.get('content-type') ?? '';
      const reader = res.body?.getReader();
      if (!reader) {
        return { ok: false, status, reason: 'no response body' };
      }
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            return { ok: false, status, reason: 'response too large' };
          }
          chunks.push(value);
        }
      }
      const buf = new Uint8Array(bytes);
      let offset = 0;
      for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (!res.ok) return { ok: false, status, reason: `HTTP ${status}` };
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
      return { ok: true, status, text, contentType, headers };
    }
    return { ok: false, status: 0, reason: `too many redirects (>${MAX_REDIRECTS})` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort')) return { ok: false, status: 0, reason: 'timeout' };
    return { ok: false, status: 0, reason: msg };
  } finally {
    clearTimeout(t);
  }
}

function bandFor(percent: number): AuditResult['band'] {
  if (percent < 41) return 'invisible';
  if (percent < 71) return 'weak';
  if (percent < 91) return 'discoverable';
  return 'ready';
}

function bandLabel(b: AuditResult['band']): string {
  switch (b) {
    case 'invisible': return 'Invisible';
    case 'weak': return 'Weak signal';
    case 'discoverable': return 'Discoverable';
    case 'ready': return 'AEO ready';
  }
}

function bandKicker(hostname: string, b: AuditResult['band']): string {
  switch (b) {
    case 'invisible':
      return `AI engines can't reliably find or cite ${hostname} for what it actually sells.`;
    case 'weak':
      return `${hostname} is partially readable to AI engines. Significant signal is being left on the table.`;
    case 'discoverable':
      return `${hostname} is in good shape. A few targeted fixes would move it to AEO-ready.`;
    case 'ready':
      return `${hostname} is set up cleanly for AI engine citation. Maintain, don't rebuild.`;
  }
}

function letterGrade(passed: number, total: number): string {
  if (total === 0) return 'N/A';
  const pct = (passed / total) * 100;
  if (pct >= 90) return 'A';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 40) return 'D';
  return 'F';
}

// ============================================================
// Check helpers
// ============================================================

function extractJsonLd(html: string): unknown[] {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: unknown[] = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>');
      blocks.push(JSON.parse(raw));
    } catch {}
  }
  return blocks;
}

function flattenJsonLd(blocks: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    out.push(obj);
    if (Array.isArray(obj['@graph'])) (obj['@graph'] as unknown[]).forEach(walk);
  };
  blocks.forEach(walk);
  return out;
}

function hasJsonLdType(flat: Record<string, unknown>[], type: string): boolean {
  return flat.some((n) => {
    const t = n['@type'];
    if (typeof t === 'string') return t === type;
    if (Array.isArray(t)) return t.includes(type);
    return false;
  });
}

function metaContent(html: string, attrName: string, attrValue: string): string | null {
  const re = new RegExp(`<meta\\s+(?:[^>]*\\s)?${attrName}=["']${attrValue.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<meta\\s+(?:[^>]*\\s)?content=["']([^"']*)["'][^>]*${attrName}=["']${attrValue.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function canonicalHref(html: string): string | null {
  const m = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (m) return m[1];
  const m2 = html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  return m2 ? m2[1] : null;
}

// Upgrade 7 - the reliability tag for one finished check. Rule of thumb: a
// positive result (something found, a number measured) is assertable; a
// negative result is only assertable when the method sees absence
// authoritatively (a real network fetch - a 404 is a 404). HTML parsing,
// regex, and allowlists false-negative on static HTML, so their absences are
// soft UNLESS the headless pass rendered the DOM (post-JS, post-scroll,
// post-settle) - then the rendered DOM IS what the prospect's visitors see
// and an absence is real evidence, not a parser miss.
export function reliabilityFor(c: DraftCheck, headlessRan = false): ReliabilityTag {
  // Tracking checks carry a measured state.
  if (c.measurement) {
    const s = c.measurement.state;
    // We saw the tag's code on the page or its beacon fire - presence is fact.
    if (s === 'present' || s === 'firing' || s === 'events-observed') return 'verified';
    // A real render not seeing the beacon is decent evidence, but a tag can
    // load late or sit behind a consent gate. Never assert the absence.
    return 'soft-absence';
  }
  switch (c.id) {
    // Real network fetches: a 200 and a 404 are both authoritative.
    case 'llms-txt':
    case 'llms-full':
    case 'robots':
    case 'robots-sitemap':
      return 'verified';
    default:
      // Positive results are always verified (the parser found the thing).
      if (c.passed) return 'verified';
      // Absence is verified when the headless pass rendered the full DOM -
      // we saw what the visitor sees. Without headless, an absence might
      // just be a JS-rendered element the static parser missed, so soft.
      return headlessRan ? 'verified' : 'soft-absence';
  }
}

// ============================================================
// Run audit
// ============================================================

export interface RunAuditOptions {
  // The headless-rendered DOM (post-JS hydration). When supplied, every
  // homepage-derived check parses this instead of the static fetch. The
  // static fetch stays as the fallback. See Upgrade 2 (rendered-DOM backbone).
  renderedHtml?: string;
  // The headless tracking capture (HeadlessResult['tracking']). When supplied,
  // the tracking checks report runtime truth - present / firing /
  // events-observed - instead of static presence only. See Upgrade 3.
  headlessTracking?: HeadlessTrackingCapture;
  // Upgrade 1 - when true, runAudit also discovers and crawls the prospect's
  // key pages (contact / money / about) so conversion is judged across the
  // real site, not just the homepage. v3.astro sets it; legacy callers do not.
  crawl?: boolean;
  // Upgrade 4 - the headless conversion-path trace (HeadlessResult.conversionPath).
  // When supplied, runAudit reports it as a conversion-path check.
  conversionPath?: ConversionPathResult;
}

export async function runAudit(rawUrl: string, opts?: RunAuditOptions): Promise<AuditResult> {
  const startedAt = Date.now();
  const norm = normalizeAuditUrl(rawUrl);
  if ('error' in norm) {
    return errorResult(rawUrl, norm.error, startedAt);
  }
  const { url, hostname } = norm;
  const origin = new URL(url).origin;

  // Parallel fetches: homepage + ancillary files
  const [home, robots, sitemap, llms, llmsFull] = await Promise.all([
    safeFetch(url),
    safeFetch(`${origin}/robots.txt`),
    safeFetch(`${origin}/sitemap.xml`),
    safeFetch(`${origin}/llms.txt`),
    safeFetch(`${origin}/llms-full.txt`),
  ]);

  // Resolve sitemap with fallbacks: /sitemap.xml → /sitemap-index.xml; then if it's a sitemapindex, follow to first inner sitemap
  let sitemapResolved = sitemap;
  let sitemapAlt: typeof sitemap | null = null;
  if (!sitemap.ok) {
    sitemapAlt = await safeFetch(`${origin}/sitemap-index.xml`);
    if (sitemapAlt.ok) sitemapResolved = sitemapAlt;
  }
  // Follow sitemap index → first inner sitemap, regardless of which fallback got us here
  if (sitemapResolved.ok && /<sitemapindex/i.test(sitemapResolved.text)) {
    const inner = sitemapResolved.text.match(/<loc>([^<]+)<\/loc>/i)?.[1];
    if (inner) {
      const innerRes = await safeFetch(inner);
      if (innerRes.ok) sitemapResolved = innerRes;
    }
  }

  const staticHtml = home.ok ? home.text : '';
  // Upgrade 2 — the rendered DOM is the backbone. When v3.astro supplies the
  // headless-rendered page, every homepage-derived check parses that instead
  // of the static fetch, killing the false-negative class (JS-injected forms,
  // framework-rendered schema, canonical tags). Static fetch is the fallback.
  const rendered =
    opts?.renderedHtml && opts.renderedHtml.trim().length > 0 ? opts.renderedHtml : null;

  // Fail only when there is no homepage HTML at all. A WAF that blocks the
  // static fetch but not real Chromium still yields a rendered DOM — audit it.
  if (!home.ok && !rendered) {
    return errorResult(url, `Could not fetch ${url}. Reason: ${home.reason}.`, startedAt);
  }

  const checkHtml = rendered ?? staticHtml;
  const jsonLdBlocks = extractJsonLd(checkHtml);
  const flat = flattenJsonLd(jsonLdBlocks);

  // Upgrade 1 — crawl the prospect's key pages (contact / money / about) so
  // conversion is judged across the real site, not just the homepage. Gated
  // behind opts.crawl: v3.astro opts in; legacy callers stay fast.
  let crawledPages: CrawledPage[] = [];
  if (opts?.crawl) {
    const sitemapText = sitemapResolved.ok ? sitemapResolved.text : '';
    const discovered = discoverKeyPages(checkHtml, sitemapText, origin);
    crawledPages = (await crawlPages(discovered)).pages;
  }

  // The checks. Built as drafts, then finalized with a reliability tag.
  const draft: DraftCheck[] = [];

  // CRAWL
  {
    const ok = sitemapResolved.ok || (sitemapAlt?.ok ?? false);
    draft.push({
      id: 'sitemap',
      category: 'crawl',
      label: 'Sitemap reachable',
      passed: ok,
      weight: 1,
      evidence: ok ? `200 at ${origin}/sitemap.xml (or sitemap-index.xml)` : `404 at /sitemap.xml`,
      finding: ok
        ? `Sitemap reachable at /sitemap.xml. AI crawlers and search engines can use it to discover your pages.`
        : `No sitemap.xml. Search engines and AI crawlers walk the site by guessing, which means most of your pages stay invisible. Generate a sitemap and reference it from robots.txt.`,
    });
  }
  {
    const text = sitemapResolved.ok ? sitemapResolved.text : '';
    const urlCount = (text.match(/<loc>/g) || []).length;
    const ok = urlCount >= 5;
    draft.push({
      id: 'sitemap-size',
      category: 'crawl',
      label: 'Sitemap has 5+ URLs',
      passed: ok,
      weight: 1,
      evidence: `${urlCount} <loc> entries`,
      finding: ok
        ? `Sitemap lists ${urlCount} URLs. AI engines treat that as a real publishing site, not a single landing page.`
        : urlCount === 0
          ? `Sitemap is missing or empty. There are zero URLs for crawlers to walk.`
          : `Sitemap lists only ${urlCount} URLs. Below the threshold (5) that signals an actively-published site. Add more content URLs or include blog posts in the index.`,
    });
  }
  {
    const ok = robots.ok;
    const text = robots.ok ? robots.text.toLowerCase() : '';
    // Check if AI bots are blocked
    const blocksAi = ok && /user-agent:\s*(gptbot|google-extended|perplexitybot|claudebot|chatgpt-user)/i.test(text) && /disallow:\s*\//i.test(text);
    const passed = ok && !blocksAi;
    draft.push({
      id: 'robots',
      category: 'crawl',
      label: 'robots.txt present, AI bots not blocked',
      passed,
      weight: 2,
      evidence: ok ? `200 at /robots.txt; AI bots ${blocksAi ? 'blocked' : 'allowed'}` : `404 at /robots.txt`,
      finding: !ok
        ? `No robots.txt. Most crawlers tolerate this, but the absence means you're not signaling preferences to anyone. Ship a permissive robots.txt that explicitly allows GPTBot, Google-Extended, PerplexityBot, ClaudeBot, and points to your sitemap.`
        : blocksAi
          ? `robots.txt is explicitly blocking one or more AI crawlers (GPTBot, ClaudeBot, PerplexityBot, or Google-Extended). If you want AI engines to find and cite you, remove those Disallow rules.`
          : `robots.txt is present and not blocking AI crawlers. Baseline hygiene.`,
    });
  }
  {
    const text = robots.ok ? robots.text : '';
    const ok = /sitemap:\s*https?:/i.test(text);
    draft.push({
      id: 'robots-sitemap',
      category: 'crawl',
      label: 'robots.txt references the sitemap',
      passed: ok,
      weight: 1,
      evidence: ok ? `Sitemap: directive found in robots.txt` : `No Sitemap: directive`,
      finding: ok
        ? `robots.txt points to the sitemap. Crawlers that hit robots.txt first find the sitemap too.`
        : `robots.txt does not reference your sitemap. Crawlers that find robots.txt before stumbling onto sitemap.xml miss the index entirely. Add a single line: Sitemap: ${origin}/sitemap.xml`,
    });
  }

  // SCHEMA
  {
    const ok = hasJsonLdType(flat, 'Organization');
    draft.push({
      id: 'org-schema',
      category: 'schema',
      label: 'Organization JSON-LD on homepage',
      passed: ok,
      weight: 2,
      evidence: ok ? `Organization @type found` : `No Organization schema on homepage`,
      finding: ok
        ? `Organization schema is present on the homepage. AI engines can resolve who you are, what you do, and link your brand to a sameAs identity.`
        : `No Organization JSON-LD on the homepage. AI engines have no structured way to identify your business as an entity. Add a single <script type="application/ld+json"> block with name, url, logo, sameAs.`,
    });
  }
  {
    const ok = hasJsonLdType(flat, 'WebSite');
    draft.push({
      id: 'website-schema',
      category: 'schema',
      label: 'WebSite JSON-LD on homepage',
      passed: ok,
      weight: 1,
      evidence: ok ? `WebSite @type found` : `No WebSite schema on homepage`,
      finding: ok
        ? `WebSite schema is present. Search engines can construct a sitelinks search box and AI engines have a canonical site identity.`
        : `No WebSite JSON-LD on the homepage. Add a small WebSite schema block alongside Organization. This is two lines and powers sitelinks search in Google.`,
    });
  }

  // META
  {
    const author = metaContent(checkHtml, 'name', 'author');
    const ok = !!author && author.trim().length > 0;
    draft.push({
      id: 'meta-author',
      category: 'meta',
      label: '<meta name="author"> present',
      passed: ok,
      weight: 1,
      evidence: ok ? `author: "${author}"` : `no author meta tag`,
      finding: ok
        ? `Author meta tag is set. AI engines use this as one input when resolving authorship for citation.`
        : `No author meta tag. AI engines have to guess at authorship from the page body. Add <meta name="author" content="Your Name"> in <head>.`,
    });
  }
  {
    const canon = canonicalHref(checkHtml);
    const ok = !!canon;
    let evidence = ok ? `canonical: ${canon}` : `no <link rel="canonical">`;
    draft.push({
      id: 'canonical',
      category: 'meta',
      label: 'Canonical link on homepage',
      passed: ok,
      weight: 1,
      evidence,
      finding: ok
        ? `Canonical link is set. Crawlers know which URL is the authoritative version of this page.`
        : `No <link rel="canonical"> on the homepage. Add one. Without it, www / non-www / trailing-slash variants compete for indexation and dilute authority.`,
    });
  }
  {
    const ogType = metaContent(checkHtml, 'property', 'og:type');
    const ok = !!ogType;
    draft.push({
      id: 'og-type',
      category: 'meta',
      label: 'og:type set on homepage',
      passed: ok,
      weight: 1,
      evidence: ok ? `og:type: "${ogType}"` : `no og:type`,
      finding: ok
        ? `og:type is "${ogType}". Link previews on LinkedIn, Slack, Twitter, and iMessage render correctly.`
        : `No og:type meta. Link previews fall back to generic. Add <meta property="og:type" content="website"> on the homepage.`,
    });
  }

  // AEO
  {
    const ok = llms.ok && llms.text.trim().length > 0;
    draft.push({
      id: 'llms-txt',
      category: 'aeo',
      label: '/llms.txt reachable',
      passed: ok,
      weight: 4,
      evidence: ok ? `200 at /llms.txt (${llms.text.length} bytes)` : `${llms.ok ? 'empty' : llms.reason} at /llms.txt`,
      finding: ok
        ? `/llms.txt is present. AI agents pulling from your domain find a canonical index of your content. This is the single biggest AEO signal you can ship right now.`
        : `No /llms.txt. AI agents (Claude, ChatGPT, Perplexity) that try to discover your content via the emerging llmstxt.org convention hit a 404 and walk away. Ship a /llms.txt with one line per indexable page. This is the highest-leverage fix.`,
    });
  }
  {
    const ok = llmsFull.ok && llmsFull.text.trim().length > 0;
    draft.push({
      id: 'llms-full',
      category: 'aeo',
      label: '/llms-full.txt reachable (bonus)',
      passed: ok,
      weight: 2,
      evidence: ok ? `200 at /llms-full.txt (${llmsFull.text.length} bytes)` : `${llmsFull.ok ? 'empty' : llmsFull.reason} at /llms-full.txt`,
      finding: ok
        ? `/llms-full.txt is present. Bulk-readable full content corpus. Perplexity's crawler and Claude's web fetch tools both pull this when it exists.`
        : `No /llms-full.txt. The bulk-readable companion to llms.txt. Some AI tools fetch this when they want the full corpus in one request instead of walking your sitemap.`,
    });
  }

  // SEND-READINESS
  {
    const bodyText = checkHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const above = bodyText.slice(0, 1500);
    const phonePresent = /(tel:|\+?\d[\d\s().-]{8,}\d)/.test(checkHtml) || /(\bcalendly|cal\.com|savvycal|acuityscheduling)/i.test(checkHtml);
    const ok = phonePresent;
    draft.push({
      id: 'contact-cta',
      category: 'aeo',
      label: 'Reachable contact / scheduling on homepage',
      passed: ok,
      weight: 1,
      evidence: ok ? `phone or scheduling link present` : `no phone or scheduling found in homepage HTML`,
      finding: ok
        ? `Homepage exposes a phone number or scheduling link. A prospect arriving from a cold DM can act inside thirty seconds.`
        : `No visible phone number or scheduling link on the homepage. A cold prospect lands here and has to hunt for how to talk to you. Surface a tel: link or a Calendly/Cal.com link in the hero or nav.`,
    });
  }
  {
    const trustImg = /<img[^>]*alt=["'][^"']*(logo|y combinator|ycombinator|techcrunch|forbes|fortune|wsj|bloomberg|trustpilot|capterra|g2)[^"']*["']/i;
    const trustText = /(featured in|as seen in|trusted by|backed by)/i;
    const hasTrust = trustImg.test(checkHtml) || trustText.test(checkHtml);
    draft.push({
      id: 'trust-signal',
      category: 'aeo',
      label: 'Trust signals visible on homepage',
      passed: hasTrust,
      weight: 1,
      evidence: hasTrust ? `trust-signal keyword or alt-text found` : `no obvious trust signals on homepage`,
      finding: hasTrust
        ? `Homepage carries trust signals (client logos, press, or social proof references). Cold visitors get credibility before they have to read.`
        : `No obvious trust signals on the homepage. No client logos, no press mentions, no testimonials with names. Cold operators evaluate by proof; a hero that's all claim and no proof reads as low-credibility. Add three named client logos or a single named-quote pull.`,
    });
  }

  // === tracking stack ===
  // Detection logic lives in ./tracking so it is unit-testable against
  // real-shape fixtures without going through the runAudit fetch path
  // (which has an SSRF guard that blocks localhost test servers).
  //
  // Upgrade 3 — the static scan answers "is the tag's code on the page"; the
  // headless capture (opts.headlessTracking) answers "did it actually fire,
  // and with what events". measureTracking merges them into one honest state
  // per vendor: absent / present / firing / events-observed.
  const tracking = detectTracking(checkHtml);
  const measured = measureTracking(tracking, opts?.headlessTracking ?? null);

  const trackingCheck = (
    id: string,
    label: string,
    weight: number,
    m: PixelMeasurement,
    copy: { absent: string; present: string; firing: string },
  ): DraftCheck => {
    const evidence =
      m.state === 'events-observed'
        ? `events observed: ${m.events.join(', ')}`
        : m.state === 'firing'
          ? 'beacon observed firing during the scan'
          : m.state === 'present'
            ? 'tag code on the page; not observed firing'
            : 'not detected';
    const finding =
      m.state === 'events-observed'
        ? `${copy.firing} Events observed during the scan: ${m.events.join(', ')}.`
        : m.state === 'firing'
          ? copy.firing
          : m.state === 'present'
            ? copy.present
            : copy.absent;
    return { id, category: 'tracking', label, passed: m.state !== 'absent', weight, evidence, finding, measurement: m };
  };

  draft.push(
    trackingCheck('tracking-meta-pixel', 'Meta Pixel', 1, measured.metaPixel, {
      absent:
        'No Meta Pixel detected. If you are spending on Meta ads, the algorithm cannot learn from conversions on this page. Install the pixel and configure the lead event.',
      present:
        'Meta Pixel code is on the page, but we did not see it send data during the scan. Confirm it fires a PageView and a lead or purchase event.',
      firing: 'Meta Pixel is firing. Meta is receiving page data it can optimize ad bidding against.',
    }),
  );
  draft.push(
    trackingCheck('tracking-gtm', 'Google Tag Manager container', 1, measured.gtm, {
      absent:
        'No GTM container. Every new tracking tag requires a developer. Add GTM once and you can wire pixels and conversion events without redeploying.',
      present:
        'A GTM container is on the page, but we did not see it execute during the scan. Confirm the container is published and loading.',
      firing: 'A GTM container is live and running. New tags can be wired without code changes.',
    }),
  );
  draft.push(
    trackingCheck('tracking-ga4', 'GA4 (Google Analytics 4)', 1, measured.ga4, {
      absent:
        'No GA4 detected. Google Ads cannot optimize for conversions and any SEO work is unmeasurable. Install GA4, most easily via Google Tag Manager.',
      present:
        'GA4 appears to be configured, but we did not confirm it sending data during the scan. Verify a GA4 configuration tag fires on every page.',
      firing:
        'GA4 is installed and sending data. Google Ads bidding and SEO measurement both have what they need.',
    }),
  );
  // LinkedIn / TikTok / PostHog are weight 0 — channel-specific, recorded so
  // the teardown can surface them but not score-impacting.
  draft.push(
    trackingCheck('tracking-linkedin-insight', 'LinkedIn Insight tag', 0, measured.linkedinInsight, {
      absent: 'No LinkedIn Insight tag. Only relevant if you advertise on LinkedIn.',
      present: 'LinkedIn Insight code is on the page, but not observed firing in this scan.',
      firing:
        'LinkedIn Insight is firing. If you run LinkedIn Ads, retargeting and conversion attribution will work.',
    }),
  );
  draft.push(
    trackingCheck('tracking-tiktok-pixel', 'TikTok Pixel', 0, measured.tiktokPixel, {
      absent: 'No TikTok Pixel. Only relevant if your buyers are on TikTok.',
      present: 'TikTok Pixel code is on the page, but not observed firing in this scan.',
      firing: 'TikTok Pixel is firing.',
    }),
  );
  draft.push(
    trackingCheck('tracking-posthog', 'PostHog product analytics', 0, measured.postHog, {
      absent:
        'No PostHog. Not strictly required, but if you want feature flags, session replay, or product analytics later, it is the cheapest entry point.',
      present: 'PostHog code is on the page, but not observed firing in this scan.',
      firing: 'PostHog is installed and sending data. Product analytics infrastructure is in place.',
    }),
  );

  // === conversion paths ===
  // Upgrade 1 — conversion is judged across the homepage AND the crawled key
  // pages. A form on /contact or a CTA on /pricing now counts; the evidence
  // names where it was found, and a signal that exists only off the homepage
  // is reported honestly as present-but-not-on-the-front-door.
  const homeSignals = detectConversionSignals(checkHtml);
  // The 4 boolean conversion signals that go through conversionCheck. hasForm
  // is handled separately below because it enriches its evidence with the
  // form field count (Upgrade 9). formFieldCount/formRequiredCount are numbers,
  // not check signals, so they are excluded from this union by design.
  type BooleanSignal = 'hasTelLink' | 'hasScheduling' | 'hasChatWidget' | 'hasPromptCta';
  const conversionCheck = (
    id: string,
    label: string,
    weight: number,
    signal: BooleanSignal,
    copy: { homepage: string; elsewhere: (role: PageRole) => string; absent: string },
  ): DraftCheck => {
    const onHomepage = homeSignals[signal];
    const onOther = onHomepage ? undefined : crawledPages.find((p) => p.ok && p[signal]);
    const others = crawledPages.filter((p) => p.ok).length;
    const evidence = onHomepage
      ? 'found on the homepage'
      : onOther
        ? `found on the ${onOther.role} page, not the homepage`
        : others > 0
          ? `not found on the homepage or ${others} other key page${others === 1 ? '' : 's'}`
          : 'not found on the homepage';
    const finding = onHomepage
      ? copy.homepage
      : onOther
        ? copy.elsewhere(onOther.role)
        : copy.absent;
    return {
      id,
      category: 'conversion',
      label,
      passed: onHomepage || !!onOther,
      weight,
      evidence,
      finding,
    };
  };

  // Upgrade 9 - form check enriches the label with field count so the cell's
  // check list surfaces "Form available on the site — 7 fields, 4 required"
  // instead of generic "Form available on the site". A 14-field beast reads
  // very differently from a 2-field lead gate to a cold prospect.
  //
  // The field count goes in the label, not the evidence: v3-synth.ts's
  // checksFromCategory passes c.label through to the rendered VerdictCheck
  // but drops c.evidence (the engine-layer audit trail). Surfacing in label
  // is the path that actually reaches the user.
  {
    const onHomepage = homeSignals.hasForm;
    const onOther = onHomepage ? undefined : crawledPages.find((p) => p.ok && p.hasForm);
    const others = crawledPages.filter((p) => p.ok).length;
    const fieldsSource = onHomepage ? homeSignals : onOther;
    const fieldCount = fieldsSource?.formFieldCount ?? 0;
    const requiredCount = fieldsSource?.formRequiredCount ?? 0;
    // Build the "(N fields, M required)" suffix only when we actually counted
    // fields. Some forms render fields via JS post-load and the static parse
    // sees a <form> with zero <input>s - in that case omit the suffix rather
    // than reporting a misleading "0 fields".
    const fieldNote =
      fieldCount > 0
        ? ` (${fieldCount} field${fieldCount === 1 ? '' : 's'}${
            requiredCount > 0 ? `, ${requiredCount} required` : ''
          })`
        : '';
    // Label suffix only attaches when a form WAS found AND we counted fields.
    // When no form is found the label stays clean ("Form available on the site")
    // so the ranked-fix prose isn't littered with "(0 fields)".
    const labelSuffix = (onHomepage || onOther) && fieldNote ? fieldNote : '';
    const evidence = onHomepage
      ? `form on the homepage${fieldNote}`
      : onOther
        ? `form on the ${onOther.role} page${fieldNote}, not the homepage`
        : others > 0
          ? `no form on the homepage or ${others} other key page${others === 1 ? '' : 's'}`
          : 'no form on the homepage';
    const finding = onHomepage
      ? `The homepage carries a form${fieldNote}. A cold visitor can convert without an extra click.`
      : onOther
        ? `A form sits on the ${onOther.role} page${fieldNote}, but not the homepage. A cold visitor landing on the front door has to navigate to convert - that extra step costs roughly half the completions.`
        : 'No form for a cold visitor to convert through. Put a short form on the homepage - two extra clicks to find one costs roughly half the completions.';
    draft.push({
      id: 'conversion-form-on-page',
      category: 'conversion',
      label: `Form available on the site${labelSuffix}`,
      passed: onHomepage || !!onOther,
      weight: 1,
      evidence,
      finding,
    });
  }
  draft.push(
    conversionCheck('conversion-tel-link', 'Tappable phone number', 1, 'hasTelLink', {
      homepage: 'A tappable phone link is on the homepage. Mobile visitors can call without typing.',
      elsewhere: (role) =>
        `A tappable phone link is on the ${role} page, but not the homepage. Mobile visitors on the front door cannot call in one tap.`,
      absent:
        'No tappable phone link. Mobile visitors who want to call have to memorise the number, switch apps, and dial. For service businesses that is a real conversion drop.',
    }),
  );
  draft.push(
    conversionCheck('conversion-scheduling-link', 'Self-serve scheduling link', 1, 'hasScheduling', {
      homepage:
        'A self-serve scheduling link is on the homepage. Cold prospects can book without sending an email.',
      elsewhere: (role) =>
        `A self-serve scheduling link is on the ${role} page, but not the homepage. Prospects on the front door cannot book in one click.`,
      absent:
        'No self-serve scheduling. Every meeting needs email back-and-forth. Add Calendly or Cal.com to the contact area.',
    }),
  );
  draft.push(
    conversionCheck('conversion-chat-widget', 'Live or async chat widget', 0.5, 'hasChatWidget', {
      homepage:
        'A chat widget is installed. Visitors with quick questions can ask without filling a form.',
      elsewhere: (role) => `A chat widget is on the ${role} page but not the homepage.`,
      absent:
        'No chat widget. Skippable if you handle inbound by phone or email; useful if your buyers expect async chat.',
    }),
  );
  draft.push(
    conversionCheck('conversion-prominent-cta', 'Prominent CTA above the fold', 1, 'hasPromptCta', {
      homepage:
        'A high-intent CTA sits above the fold on the homepage. Cold visitors know how to act in the first viewport.',
      elsewhere: (role) =>
        `A high-intent CTA is on the ${role} page, but the homepage hero has none. Cold visitors land on the front door and have to figure out what to do.`,
      absent:
        'No obvious high-intent CTA above the fold. Cold visitors land and have to figure out what you want them to do. Add one button, one verb, one outcome.',
    }),
  );

  // Upgrade 4 — the conversion-path trace, when the headless pass ran it.
  // Turns "is there a form" into "how many clicks from the CTA to a form".
  const cp = opts?.conversionPath;
  if (cp) {
    const reached = cp.outcome === 'form-on-homepage' || cp.outcome === 'form-after-click';
    const cta = cp.primaryCtaText ? `"${cp.primaryCtaText}"` : 'the primary CTA';
    let cpEvidence: string;
    let cpFinding: string;
    switch (cp.outcome) {
      case 'form-on-homepage':
        cpEvidence = 'form reachable on the homepage, 0 clicks';
        cpFinding =
          'A visitor can convert on the homepage itself - the form is right there, zero clicks from landing.';
        break;
      case 'form-after-click':
        cpEvidence = `${cta} leads to a form in 1 click`;
        cpFinding = `The primary CTA (${cta}) leads to a submittable form in one click. A cold visitor has a clear, short path to convert.`;
        break;
      case 'no-form-reached':
        cpEvidence = `${cta} clicked, no form within 1 click`;
        cpFinding = `The primary CTA (${cta}) was clicked, but it did not lead to a submittable form within one click. A cold visitor following the obvious next step does not reach a way to convert.`;
        break;
      case 'no-cta':
        cpEvidence = 'no clear primary CTA on the homepage';
        cpFinding =
          'No clear primary call-to-action on the homepage. A cold visitor lands with no obvious next step toward converting.';
        break;
      default: // trace-failed
        cpEvidence = 'conversion-path trace did not complete';
        cpFinding = 'The conversion path could not be traced automatically in this scan.';
        break;
    }
    draft.push({
      id: 'conversion-path',
      category: 'conversion',
      label: 'Path from CTA to a form',
      passed: cp.outcome === 'trace-failed' ? true : reached,
      // trace-failed is unmeasured, not a real gap - weight 0 so it does not score.
      weight: cp.outcome === 'trace-failed' ? 0 : 1,
      evidence: cpEvidence,
      finding: cpFinding,
    });
  }

  const endedAt = Date.now();

  // Upgrade 7 - finalize every draft check with its reliability tag, so a
  // soft negative is never read downstream as a hard fact. When the headless
  // pass rendered the DOM we trust absences too - the parser saw what the
  // visitor sees.
  const headlessRan = rendered != null;
  const checks: CheckResult[] = draft.map((c) => ({
    ...c,
    reliability: reliabilityFor(c, headlessRan),
  }));

  const passedWeight = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const scorePercent = totalWeight === 0 ? 0 : Math.round((passedWeight / totalWeight) * 100);
  const band = bandFor(scorePercent);

  // Per-category counts for the verdict grid
  const crawlChecks = checks.filter((c) => c.category === 'crawl');
  const schemaChecks = checks.filter((c) => c.category === 'schema');
  const metaChecks = checks.filter((c) => c.category === 'meta'); // counted under crawl in verdict for now? no — schema
  const aeoChecks = checks.filter((c) => c.category === 'aeo');

  const cnt = (arr: CheckResult[]) => ({ passed: arr.filter((c) => c.passed).length, total: arr.length });
  const cCrawl = cnt(crawlChecks);
  const cSchema = cnt([...schemaChecks, ...metaChecks]);
  const cAeo = cnt(aeoChecks.filter((c) => c.id.startsWith('llms')));
  const cSend = cnt(aeoChecks.filter((c) => !c.id.startsWith('llms')));

  return {
    url,
    hostname,
    fetchedAt: new Date(startedAt).toISOString(),
    durationMs: endedAt - startedAt,
    homepageHtml: home.ok ? staticHtml : (rendered ?? undefined),
    homepageHeaders: home.ok ? home.headers : undefined,
    checks,
    crawledPages,
    scoreNumeric: passedWeight,
    scoreMax: totalWeight,
    scorePercent,
    band,
    bandLabel: bandLabel(band),
    bandKicker: bandKicker(hostname, band),
    verdict: {
      crawl: { grade: letterGrade(cCrawl.passed, cCrawl.total), passed: cCrawl.passed, total: cCrawl.total },
      schema: { grade: letterGrade(cSchema.passed, cSchema.total), passed: cSchema.passed, total: cSchema.total },
      aeo: { grade: letterGrade(cAeo.passed, cAeo.total), passed: cAeo.passed, total: cAeo.total },
      sendReady: { grade: letterGrade(cSend.passed, cSend.total), passed: cSend.passed, total: cSend.total },
    },
  };
}

function errorResult(url: string, error: string, startedAt: number): AuditResult {
  return {
    url,
    hostname: '',
    fetchedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    checks: [],
    scoreNumeric: 0,
    scoreMax: 0,
    scorePercent: 0,
    band: 'invisible',
    bandLabel: 'Could not audit',
    bandKicker: error,
    verdict: {
      crawl: { grade: 'N/A', passed: 0, total: 0 },
      schema: { grade: 'N/A', passed: 0, total: 0 },
      aeo: { grade: 'N/A', passed: 0, total: 0 },
      sendReady: { grade: 'N/A', passed: 0, total: 0 },
    },
    error,
  };
}

export function rankedRecommendations(result: AuditResult): Array<{ priority: number; check: CheckResult }> {
  return result.checks
    .filter((c) => !c.passed)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((check, i) => ({ priority: i + 1, check }));
}

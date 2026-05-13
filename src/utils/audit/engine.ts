// AEO audit engine. Fetches a target URL, runs checks, returns structured findings.
// Designed to run inside a Vercel Function within ~10s budget.

import { detectTracking } from './tracking';

export interface CheckResult {
  id: string;
  category: 'crawl' | 'schema' | 'meta' | 'aeo' | 'tracking' | 'conversion';
  label: string;
  passed: boolean;
  weight: number;
  evidence: string;
  finding: string;
}

export interface AuditResult {
  url: string;
  hostname: string;
  fetchedAt: string;
  durationMs: number;
  homepageHtml?: string;
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
  error?: string;
}

const FETCH_TIMEOUT_MS = 12000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'RivettAEO/0.1 (+https://rivett.tech/audit)';

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

async function safeFetch(url: string): Promise<{ ok: true; status: number; text: string; contentType: string } | { ok: false; status: number; reason: string }> {
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
      return { ok: true, status, text, contentType };
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

// ============================================================
// Run audit
// ============================================================

export async function runAudit(rawUrl: string): Promise<AuditResult> {
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

  const homeText = home.ok ? home.text : '';
  const jsonLdBlocks = home.ok ? extractJsonLd(homeText) : [];
  const flat = flattenJsonLd(jsonLdBlocks);

  if (!home.ok) {
    return errorResult(url, `Could not fetch ${url}. Reason: ${home.reason}.`, startedAt);
  }

  // The checks
  const checks: CheckResult[] = [];

  // CRAWL
  {
    const ok = sitemapResolved.ok || (sitemapAlt?.ok ?? false);
    checks.push({
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
    checks.push({
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
    checks.push({
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
    checks.push({
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
    checks.push({
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
    checks.push({
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
    const author = metaContent(homeText, 'name', 'author');
    const ok = !!author && author.trim().length > 0;
    checks.push({
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
    const canon = canonicalHref(homeText);
    const ok = !!canon;
    let evidence = ok ? `canonical: ${canon}` : `no <link rel="canonical">`;
    checks.push({
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
    const ogType = metaContent(homeText, 'property', 'og:type');
    const ok = !!ogType;
    checks.push({
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
    checks.push({
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
    checks.push({
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
    const bodyText = homeText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const above = bodyText.slice(0, 1500);
    const phonePresent = /(tel:|\+?\d[\d\s().-]{8,}\d)/.test(homeText) || /(\bcalendly|cal\.com|savvycal|acuityscheduling)/i.test(homeText);
    const ok = phonePresent;
    checks.push({
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
    const hasTrust = trustImg.test(homeText) || trustText.test(homeText);
    checks.push({
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
  const tracking = detectTracking(homeText);
  checks.push({
    id: 'tracking-meta-pixel',
    category: 'tracking',
    label: 'Meta Pixel',
    passed: tracking.metaPixel,
    weight: 1,
    evidence: tracking.metaPixel ? 'fbq() or fbevents.js detected' : 'no Meta Pixel found',
    finding: tracking.metaPixel
      ? 'Meta Pixel is firing. Meta has the conversion data it needs to optimize bidding.'
      : 'No Meta Pixel detected. If you are spending on Meta ads, the algorithm cannot learn from conversions on this page. Install the pixel and configure the lead event.',
  });
  checks.push({
    id: 'tracking-gtm',
    category: 'tracking',
    label: 'Google Tag Manager container',
    passed: tracking.gtm.detected,
    weight: 1,
    evidence: tracking.gtm.detected
      ? `GTM detected${tracking.gtm.gtmId ? ` (${tracking.gtm.gtmId})` : ' (via googletagmanager.com host)'}`
      : 'no GTM container found',
    finding: tracking.gtm.detected
      ? 'A GTM container is present. New tags can be added without code changes.'
      : 'No GTM container. Every new tracking tag requires a developer. Add GTM once and you can wire pixels and conversion events without redeploying.',
  });
  checks.push({
    id: 'tracking-ga4',
    category: 'tracking',
    label: 'GA4 (Google Analytics 4)',
    passed: tracking.ga4.detected,
    weight: 1,
    evidence: tracking.ga4.direct
      ? 'direct GA4 config detected'
      : tracking.ga4.detected
        ? 'GTM container present — GA4 likely loaded inside it'
        : 'no GA4 config found',
    finding: tracking.ga4.direct
      ? 'GA4 is installed directly. Google Ads bidding and SEO measurement both have the data they need.'
      : tracking.ga4.detected
        ? 'GTM container is present. GA4 is most likely loaded inside it. We could not confirm from the static HTML alone — verify in GTM that a GA4 configuration tag is firing on all pages.'
        : 'No GA4 tag detected. Google Ads cannot optimize for conversions, and any SEO work is unmeasurable. Install via Google Tag Manager — twenty minutes.',
  });
  checks.push({
    id: 'tracking-linkedin-insight',
    category: 'tracking',
    label: 'LinkedIn Insight tag',
    passed: tracking.linkedinInsight,
    // Weight 0: LinkedIn Insight is only meaningful for B2B LinkedIn Ads.
    // Recorded so the LP audit can surface it, but not score-impacting.
    weight: 0,
    evidence: tracking.linkedinInsight ? 'lintrk() or LinkedIn partner ID detected' : 'no LinkedIn Insight tag found',
    finding: tracking.linkedinInsight
      ? 'LinkedIn Insight is firing. If you run LinkedIn Ads, retargeting and conversion attribution will work.'
      : 'No LinkedIn Insight tag. Only relevant if you advertise on LinkedIn.',
  });
  checks.push({
    id: 'tracking-tiktok-pixel',
    category: 'tracking',
    label: 'TikTok Pixel',
    passed: tracking.tiktokPixel,
    weight: 0,
    evidence: tracking.tiktokPixel ? 'ttq pixel detected' : 'no TikTok Pixel found',
    finding: tracking.tiktokPixel
      ? 'TikTok Pixel is firing.'
      : 'No TikTok Pixel. Only relevant if your buyers are on TikTok.',
  });
  checks.push({
    id: 'tracking-posthog',
    category: 'tracking',
    label: 'PostHog product analytics',
    passed: tracking.postHog,
    // Weight 0: PostHog is a substitute for GA4 for many operators. Recorded
    // for completeness; the GA4 check is what counts toward the score.
    weight: 0,
    evidence: tracking.postHog ? 'posthog.init() or posthog host detected' : 'no PostHog detected',
    finding: tracking.postHog
      ? 'PostHog is installed. Product analytics and feature-flag infrastructure are in place.'
      : 'No PostHog. Not strictly required, but if you want feature flags, session replay, or product analytics later, it is the cheapest entry point.',
  });

  // === conversion paths ===
  {
    const hasForm = /<form\b[^>]*>/i.test(homeText);
    checks.push({
      id: 'conversion-form-on-page',
      category: 'conversion',
      label: 'Form available on homepage',
      passed: hasForm,
      weight: 1,
      evidence: hasForm ? '<form> tag present in homepage HTML' : 'no <form> tag found',
      finding: hasForm
        ? 'The homepage carries a form. A cold visitor can convert without an extra click.'
        : 'No form on the homepage. A cold visitor has to navigate to convert. Two extra clicks costs roughly half the form completions.',
    });
  }
  {
    const tel = /\bhref=["']tel:/i.test(homeText);
    checks.push({
      id: 'conversion-tel-link',
      category: 'conversion',
      label: 'Tappable phone number',
      passed: tel,
      weight: 1,
      evidence: tel ? 'tel: link present' : 'no tel: link',
      finding: tel
        ? 'A tel: link is present. Mobile visitors can call without typing.'
        : 'No tappable phone link. Mobile visitors who want to call have to memorize the number, switch apps, type it, and dial. For service businesses this is a real conversion drop.',
    });
  }
  {
    const schedule = /(calendly\.com|cal\.com\/[a-z]|calendar\.app\.google|hubspot\.com\/meetings|chilipiper\.com|savvycal\.com|tidycal\.com)/i.test(homeText);
    checks.push({
      id: 'conversion-scheduling-link',
      category: 'conversion',
      label: 'Self-serve scheduling link',
      passed: schedule,
      weight: 1,
      evidence: schedule ? 'scheduling service link present' : 'no scheduling link',
      finding: schedule
        ? 'A self-serve scheduling link is present. Cold prospects can book without sending an email.'
        : 'No self-serve scheduling. Every meeting requires email back-and-forth. Add Calendly or Cal.com to the contact area — even five extra meetings a month justifies it.',
    });
  }
  {
    const chat = /(intercom\.io\/messenger|widget\.intercom\.io|drift\.com|js\.driftt\.com|tawk\.to|crisp\.chat|chatwidget|hubspot\.com\/conversation)/i.test(homeText);
    checks.push({
      id: 'conversion-chat-widget',
      category: 'conversion',
      label: 'Live or async chat widget',
      passed: chat,
      weight: 0.5,
      evidence: chat ? 'chat widget detected' : 'no chat widget',
      finding: chat
        ? 'A chat widget is installed. Visitors with quick questions can ask without filling a form.'
        : 'No chat widget. Skippable if you handle inbound via phone or email; useful if your buyer profile expects async chat.',
    });
  }
  {
    const heroText = homeText.slice(0, 4000);
    const hasCtaButton = /<(a|button)[^>]*\b(class|id)=["'][^"']*(cta|btn-primary|primary-cta|hero-cta|book|start|get-started|trial)/i.test(heroText)
      || /<(a|button)[^>]*>([^<]*\b(get started|start free|book a (call|demo)|request (a )?(quote|demo)|schedule (a )?(call|demo)|talk to|contact us)\b)/i.test(heroText);
    checks.push({
      id: 'conversion-prominent-cta',
      category: 'conversion',
      label: 'Prominent CTA above the fold',
      passed: hasCtaButton,
      weight: 1,
      evidence: hasCtaButton ? 'high-intent CTA pattern found in first 4KB' : 'no obvious high-intent CTA in the hero',
      finding: hasCtaButton
        ? 'A high-intent CTA sits above the fold. Cold visitors know how to act in the first viewport.'
        : 'No obvious high-intent CTA above the fold. Cold visitors land and have to figure out what you want them to do. Add one button with one verb and one outcome.',
    });
  }

  const endedAt = Date.now();
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
    homepageHtml: homeText,
    checks,
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

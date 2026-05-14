// Landing-page sub-audit. Runs against the URLs captured in
// AdsResult.sampleLandingPages — the actual money pages an operator is
// paying Meta / Google / LinkedIn to send traffic to. Our main audit reads
// the homepage; this fills the gap for ad-spending operators where the
// landing page is structurally different (different pixel coverage,
// different LCP, different conversion path) from `/`.
//
// Lite-audit only: PSI score + tracking-pixel presence + conversion checks
// (form/tel/cta). No headless render here — keeping landing audits inside
// the 60s function budget means parallel HTTP fetches + PSI only.
//
// Cap at 3 landing pages per audit. Most operators recycle the same 1-2
// landing pages across creatives; sampling 3 is enough to surface the leak.

import { checkPageSpeed, type PageSpeedResult } from './pagespeed';
import { detectTracking } from './tracking';

const MAX_LANDING_PAGES = 3;
const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface LandingPageResult {
  url: string;
  // PSI mobile performance score (0-100) or null if PSI didn't return.
  scorePercent: number | null;
  lcpMs: number | null;
  fcpMs: number | null;
  // Tracking pixels detected in the page HTML.
  hasMetaPixel: boolean;
  hasGa4: boolean;
  hasGtm: boolean;
  hasLinkedInInsight: boolean;
  // Conversion-path checks on the landing page.
  hasForm: boolean;
  hasTelLink: boolean;
  hasCtaAboveFold: boolean;
  // Aggregate counts to make the v3-synth summary cell tractable.
  trackingGaps: number;
  conversionGaps: number;
  // If the fetch fails (timeout, 4xx/5xx, SSRF block) we still emit the
  // row with this set, so the operator sees we tried and what broke.
  fetchError?: string;
}

export interface LandingAuditResult {
  pages: LandingPageResult[];
  durationMs: number;
}

// Lightweight SSRF guard — same shape as engine.ts's isBlockedHost but
// imported as a function so we don't depend on engine.ts's internals.
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
  if (BLOCKED_IPV4.some((re) => re.test(h))) return false;
  return true;
}

async function fetchLandingHtml(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
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
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
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
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort')) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: msg };
  } finally {
    clearTimeout(t);
  }
}

function emptyLanding(url: string, reason?: string): LandingPageResult {
  return {
    url,
    scorePercent: null,
    lcpMs: null,
    fcpMs: null,
    hasMetaPixel: false,
    hasGa4: false,
    hasGtm: false,
    hasLinkedInInsight: false,
    hasForm: false,
    hasTelLink: false,
    hasCtaAboveFold: false,
    trackingGaps: 4,
    conversionGaps: 3,
    fetchError: reason,
  };
}

async function auditOnePage(url: string): Promise<LandingPageResult> {
  // Run PSI and HTML fetch in parallel — the slowest of the two dominates,
  // so concurrency here is a free 5-15s.
  const [psiResult, htmlResult] = await Promise.all([
    checkPageSpeed(url, 'mobile').catch(() => null as PageSpeedResult | null),
    fetchLandingHtml(url),
  ]);

  if (!htmlResult.ok) {
    const row = emptyLanding(url, htmlResult.reason);
    // Even on fetch failure, PSI might still have returned (Google's bot can
    // sometimes get through where our UA can't). Surface those numbers.
    if (psiResult) {
      row.scorePercent = psiResult.performanceScore;
      row.lcpMs = psiResult.lcpMs;
      row.fcpMs = psiResult.fcpMs;
    }
    return row;
  }

  const html = htmlResult.text;
  const tracking = detectTracking(html);

  // Conversion-path checks. These mirror the homepage conversion checks in
  // engine.ts so a comparison between homepage and landing reads cleanly.
  const hasForm = /<form\b[^>]*>/i.test(html);
  const hasTelLink = /\bhref=["']tel:/i.test(html);
  const heroText = html.slice(0, 4000);
  const hasCta =
    /<(a|button)[^>]*\b(class|id)=["'][^"']*(cta|btn-primary|primary-cta|hero-cta|book|start|get-started|trial)/i.test(
      heroText,
    ) ||
    /<(a|button)[^>]*>([^<]*\b(get started|start free|book a (call|demo)|request (a )?(quote|demo)|schedule (a )?(call|demo)|talk to|contact us)\b)/i.test(
      heroText,
    );

  const trackingGaps =
    Number(!tracking.metaPixel) +
    Number(!tracking.ga4.detected) +
    Number(!tracking.gtm.detected) +
    Number(!tracking.linkedinInsight);
  const conversionGaps =
    Number(!hasForm) + Number(!hasTelLink) + Number(!hasCta);

  return {
    url,
    scorePercent: psiResult?.performanceScore ?? null,
    lcpMs: psiResult?.lcpMs ?? null,
    fcpMs: psiResult?.fcpMs ?? null,
    hasMetaPixel: tracking.metaPixel,
    hasGa4: tracking.ga4.detected,
    hasGtm: tracking.gtm.detected,
    hasLinkedInInsight: tracking.linkedinInsight,
    hasForm,
    hasTelLink,
    hasCtaAboveFold: hasCta,
    trackingGaps,
    conversionGaps,
  };
}

export async function auditLandingPages(
  urls: string[] | undefined | null,
): Promise<LandingAuditResult> {
  const started = Date.now();
  if (!urls || urls.length === 0) return { pages: [], durationMs: 0 };

  // Dedupe + cap. Most ad libraries return multiple creatives pointing at
  // the same /pricing or /book-a-demo, so the dedupe keeps the sample
  // efficient.
  const unique = [...new Set(urls.map((u) => u.split('#')[0]))].slice(
    0,
    MAX_LANDING_PAGES,
  );

  const pages = await Promise.all(unique.map(auditOnePage));
  return { pages, durationMs: Date.now() - started };
}

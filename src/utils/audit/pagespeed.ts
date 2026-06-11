// PageSpeed Insights (Lighthouse) check via Google's public API.
//
// Works without a key for low volume (anonymous quota: ~25 requests/100s
// per IP). For prod traffic, set GOOGLE_PSI_API_KEY in the Vercel project
// env and we'll include it on each request.
//
// PSI is slow (real Lighthouse run, 15-25 seconds typical; slow sites run
// 35s+ - somewhere.com clocked 36s, so a 20s budget failed it on every scan).
// The function now runs under v3.astro's maxDuration of 300s, not the old 60s
// Hobby ceiling, so the first attempt gets 45s. Still one attempt, with a
// short retry ONLY for fast transient failures (5xx / network), never for a
// timeout - a second long PSI wait after a timeout was the main cause of
// audit 504s under the old cap.
// On failure we return null and the page degrades the "How fast it loads"
// verdict cell to a "we'll measure on the call" teaser via the slug render.

export interface PageSpeedResult {
  strategy: 'mobile' | 'desktop';
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  performanceScore: number | null;
  band: 'poor' | 'needs-improvement' | 'good' | null;
}

const PSI_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_TIMEOUT_FIRST_MS = 60000;
const PSI_TIMEOUT_RETRY_MS = 12000;
const PSI_RETRY_BACKOFF_MS = 800;

function bandFromScore(score: number | null): PageSpeedResult['band'] {
  if (score == null) return null;
  if (score >= 90) return 'good';
  if (score >= 50) return 'needs-improvement';
  return 'poor';
}

function extractMetric(audit: any, key: string): number | null {
  const a = audit?.[key];
  if (!a) return null;
  const v = a.numericValue;
  return typeof v === 'number' ? v : null;
}

type PsiAttempt =
  | { ok: true; result: PageSpeedResult }
  | { ok: false; reason: 'timeout' | 'http' | 'parse' | 'unknown'; detail?: string };

async function attemptPsi(
  url: string,
  strategy: 'mobile' | 'desktop',
  timeoutMs: number,
): Promise<PsiAttempt> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  });
  const key = process.env.GOOGLE_PSI_API_KEY;
  if (key) params.set('key', key);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${PSI_URL}?${params.toString()}`, { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, reason: 'http', detail: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const lh = data?.lighthouseResult;
    if (!lh) {
      return { ok: false, reason: 'parse', detail: 'no lighthouseResult' };
    }
    const audits = lh.audits ?? {};
    const performance = lh.categories?.performance;
    const score = performance && typeof performance.score === 'number' ? performance.score * 100 : null;
    return {
      ok: true,
      result: {
        strategy,
        lcpMs: extractMetric(audits, 'largest-contentful-paint'),
        inpMs: extractMetric(audits, 'interaction-to-next-paint') ?? extractMetric(audits, 'max-potential-fid'),
        cls: audits['cumulative-layout-shift']?.numericValue ?? null,
        fcpMs: extractMetric(audits, 'first-contentful-paint'),
        ttfbMs: extractMetric(audits, 'server-response-time'),
        performanceScore: score,
        band: bandFromScore(score),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (ctrl.signal.aborted) return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'unknown', detail: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkPageSpeed(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
): Promise<PageSpeedResult | null> {
  const first = await attemptPsi(url, strategy, PSI_TIMEOUT_FIRST_MS);
  if (first.ok) return first.result;

  // Retry only fast transient failures (5xx / network). NOT timeouts: the first
  // attempt already burned 20s, and a second long PSI wait is what pushed audits
  // past the 60s function cap. A timed-out PSI just degrades to null.
  const retryable = first.reason === 'unknown' ||
    (first.reason === 'http' && /HTTP 5\d{2}/.test(first.detail ?? ''));
  if (!retryable) {
    console.warn(`[pagespeed] no retry for ${url} (${first.reason}: ${first.detail ?? '-'})`);
    return null;
  }

  await new Promise((r) => setTimeout(r, PSI_RETRY_BACKOFF_MS));

  const retry = await attemptPsi(url, strategy, PSI_TIMEOUT_RETRY_MS);
  if (retry.ok) {
    console.log(`[pagespeed] retry recovered ${url}`);
    return retry.result;
  }
  console.warn(`[pagespeed] both attempts failed for ${url} (first: ${first.reason}, retry: ${retry.reason})`);
  return null;
}

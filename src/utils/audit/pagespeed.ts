// PageSpeed Insights (Lighthouse) check via Google's public API.
//
// Works without a key for low volume (anonymous quota: ~25 requests/100s
// per IP). For prod traffic, set GOOGLE_PSI_API_KEY in the Vercel project
// env and we'll include it on each request.
//
// PSI is slow (real Lighthouse run, 15-25 seconds typical), so we use a
// generous timeout. If the call times out we return null and the page
// degrades the "How fast it loads" verdict cell to "not measured".

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
const PSI_TIMEOUT_MS = 28000;

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

export async function checkPageSpeed(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
): Promise<PageSpeedResult | null> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  });
  const key = process.env.GOOGLE_PSI_API_KEY;
  if (key) params.set('key', key);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PSI_TIMEOUT_MS);
  try {
    const res = await fetch(`${PSI_URL}?${params.toString()}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const lh = data?.lighthouseResult;
    if (!lh) return null;
    const audits = lh.audits ?? {};
    const performance = lh.categories?.performance;
    const score = performance && typeof performance.score === 'number' ? performance.score * 100 : null;
    return {
      strategy,
      lcpMs: extractMetric(audits, 'largest-contentful-paint'),
      inpMs: extractMetric(audits, 'interaction-to-next-paint') ?? extractMetric(audits, 'max-potential-fid'),
      cls: audits['cumulative-layout-shift']?.numericValue ?? null,
      fcpMs: extractMetric(audits, 'first-contentful-paint'),
      ttfbMs: extractMetric(audits, 'server-response-time'),
      performanceScore: score,
      band: bandFromScore(score),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

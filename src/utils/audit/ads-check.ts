// Ads-running check via ScrapeCreators.
//
// Queries three ad libraries in parallel:
//   - Meta (Facebook + Instagram) by company name
//   - Google by domain
//   - LinkedIn by company name
//
// Returns null if SCRAPECREATORS_API_KEY is missing — verdict cell degrades
// to "not measured". Each platform call is independent: a 404 or 0 results
// from one does not affect the others.
//
// Cost note: ScrapeCreators bills ~1 credit per ad-library call, so each
// /audit/v3 scan with this enabled burns ~3 credits.

export interface AdsResult {
  metaActive: number | null;
  googleActive: number | null;
  linkedinActive: number | null;
  earliestSeen: string | null;
  sampleLandingPages: string[];
  commentary: string;
}

const SC_BASE = 'https://api.scrapecreators.com/v1';
const TIMEOUT_MS = 12000;

function companyNameFromHostname(hostname: string): string {
  // pellaofcolumbus.com → "pellaofcolumbus"
  // www.acme.co.uk → "acme"
  const stripped = hostname.replace(/^www\./, '');
  return stripped.split('.')[0];
}

async function safeJson(url: string, headers: Record<string, string>): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function countResults(json: any): number {
  if (!json) return 0;
  if (Array.isArray(json.results)) return json.results.length;
  if (Array.isArray(json.ads)) return json.ads.length;
  return 0;
}

function extractMetaLandingPages(json: any): string[] {
  const out = new Set<string>();
  const items = json?.results ?? json?.ads ?? [];
  for (const item of items) {
    const lp = item?.snapshot?.link_url ?? item?.snapshotUrl;
    if (lp) out.add(lp);
    if (out.size >= 3) break;
  }
  return [...out];
}

function extractEarliest(json: any): string | null {
  const items = json?.results ?? json?.ads ?? [];
  const dates = items
    .map((r: any) => r.started_running ?? r.start_date ?? r.startDate)
    .filter((d: any): d is string => typeof d === 'string')
    .sort();
  return dates[0] ?? null;
}

export async function checkAds(hostname: string): Promise<AdsResult | null> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return null;

  const company = companyNameFromHostname(hostname);
  const headers = { 'x-api-key': apiKey };

  const metaUrl =
    `${SC_BASE}/facebook/adLibrary/company/ads?companyName=${encodeURIComponent(company)}` +
    `&country=US&status=ACTIVE&trim=true`;
  const googleUrl = `${SC_BASE}/google/company/ads?domain=${encodeURIComponent(hostname)}&region=US`;
  const linkedinUrl = `${SC_BASE}/linkedin/ads/search?company=${encodeURIComponent(company)}&countries=US`;

  const [metaJson, googleJson, linkedinJson] = await Promise.all([
    safeJson(metaUrl, headers),
    safeJson(googleUrl, headers),
    safeJson(linkedinUrl, headers),
  ]);

  const metaActive = countResults(metaJson);
  const googleActive = countResults(googleJson);
  const linkedinActive = countResults(linkedinJson);

  const earliestSeen = extractEarliest(metaJson);
  const sampleLandingPages = extractMetaLandingPages(metaJson);

  const total = metaActive + googleActive + linkedinActive;
  let commentary: string;
  if (total === 0) {
    commentary = `No active paid ads detected for ${hostname} across Meta, Google, or LinkedIn.`;
  } else {
    const parts: string[] = [];
    if (metaActive > 0) parts.push(`${metaActive} on Meta`);
    if (googleActive > 0) parts.push(`${googleActive} on Google`);
    if (linkedinActive > 0) parts.push(`${linkedinActive} on LinkedIn`);
    commentary = `${total} active ${total === 1 ? 'ad' : 'ads'} (${parts.join(', ')}).`;
    if (earliestSeen) commentary += ` Earliest Meta creative dates back to ${earliestSeen}.`;
  }

  return {
    metaActive,
    googleActive,
    linkedinActive,
    earliestSeen,
    sampleLandingPages,
    commentary,
  };
}

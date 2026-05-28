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

// Returns the parsed body on real success, null on transport/HTTP failure,
// or `{ error: 'credits' | 'auth' | 'unknown', message }` when ScrapeCreators
// returns a JSON error envelope (HTTP 200 with `success: false`). The previous
// implementation conflated all three into null, which countResults then turned
// into a silent "0 ads found" — meaning a depleted credit balance produced
// the same audit output as a real no-ads result. That bug burned a full
// 150-prospect audit motion in production.
type SCResponse =
  | { ok: true; body: any }
  | { ok: false; error: 'credits' | 'auth' | 'transport' | 'unknown'; message: string };

async function safeJson(url: string, headers: Record<string, string>): Promise<SCResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, error: res.status === 401 || res.status === 403 ? 'auth' : 'transport', message: `HTTP ${res.status}` };
    }
    const body = await res.json();
    if (body && typeof body === 'object' && body.success === false) {
      const msg = typeof body.message === 'string' ? body.message : '';
      if (/credit/i.test(msg)) return { ok: false, error: 'credits', message: msg };
      return { ok: false, error: 'unknown', message: msg || 'success:false' };
    }
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: 'transport', message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// Returns null (not 0) when the API call errored. Callers must distinguish
// "ads check failed" from "ads check ran and found zero ads."
function countResults(resp: SCResponse): number | null {
  if (!resp.ok) return null;
  const json = resp.body;
  if (!json) return 0;
  // Prefer the API's own total over array length: each endpoint caps the
  // returned array at one page (Google=40, Meta=30, LinkedIn=24), so
  // counting array length silently truncates anyone running more than a page.
  if (typeof json.number_of_ads_estimate === 'number') return json.number_of_ads_estimate;
  if (typeof json.searchResultsCount === 'number') return json.searchResultsCount;
  if (typeof json.totalAds === 'number') return json.totalAds;
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

  const [metaResp, googleResp, linkedinResp] = await Promise.all([
    safeJson(metaUrl, headers),
    safeJson(googleUrl, headers),
    safeJson(linkedinUrl, headers),
  ]);

  // Log credit/auth failures loudly so they don't silently corrupt audit output.
  for (const [name, r] of [['meta', metaResp], ['google', googleResp], ['linkedin', linkedinResp]] as const) {
    if (!r.ok && (r.error === 'credits' || r.error === 'auth')) {
      console.error(`[ads-check] ${name} call failed: ${r.error} - ${r.message}`);
    }
  }

  // Meta and LinkedIn ad-library lookups are keyed by a company name guessed
  // from the hostname (companyNameFromHostname). That guess fuzzy-matches
  // unrelated advertisers - the domain recom.co resolves to "recom", which
  // returns ads from Recombee, Recomaze and other "Recom*" companies (verified
  // against ScrapeCreators and the Meta Ad Library, 2026-05). Only the Google
  // lookup is keyed by the real domain. Until Meta/LinkedIn can be keyed off a
  // verified advertiser identity their counts are withheld (null = not
  // measured), so the audit never reports an ad count it cannot stand behind.
  // The Meta response is still parsed below for landing-page samples.
  const metaActive: number | null = null;
  const linkedinActive: number | null = null;
  const googleActive = countResults(googleResp);

  const earliestSeen = metaResp.ok ? extractEarliest(metaResp.body) : null;
  const sampleLandingPages = metaResp.ok ? extractMetaLandingPages(metaResp.body) : [];

  // Google is the only trustworthy ad signal (domain-keyed). If it errored,
  // the ads check is unreliable - return null so the verdict cell degrades to
  // "not measured" rather than a misleading "no ads found" (which would look
  // identical to a real zero to downstream consumers like pick-hero).
  if (googleActive === null) {
    console.error(`[ads-check] Google ad-library call errored for ${hostname} - returning null`);
    return null;
  }

  // Google-only: the audit reports the domain-keyed Google ad count, the one
  // ad number it can stand behind. Meta/LinkedIn are withheld (see above).
  const total = googleActive;
  const commentary =
    total === 0
      ? `No active paid Google ads detected for ${hostname}.`
      : `${total} active paid Google ${total === 1 ? 'ad' : 'ads'} detected for ${hostname}.`;

  return {
    metaActive,
    googleActive,
    linkedinActive,
    earliestSeen,
    sampleLandingPages,
    commentary,
  };
}

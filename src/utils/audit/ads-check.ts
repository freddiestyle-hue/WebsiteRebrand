// Ads-running check via ScrapeCreators.
//
// Queries the ad libraries in parallel:
//   - Google by domain (always trustworthy: keyed by the real domain)
//   - Meta (Facebook + Instagram) by VERIFIED page id - resolved from the
//     Facebook/Instagram links on the prospect's own homepage
//   - LinkedIn by VERIFIED company name - resolved from the linkedin.com/company
//     link on the prospect's own homepage
//
// Identity rule (the recom.co lesson): a platform count is only published when
// the lookup was keyed off an identity the prospect declared themselves. A
// hostname-derived name guess once returned Recombee's ads for recom.co, so
// guessed lookups are never counted. No self-declared link -> count stays
// null ("not measured"), never a fabricated zero.
//
// TikTok has no public ad library outside the EU; TikTok spend is signalled
// via pixel detection in tech-stack-check instead.
//
// Returns null if SCRAPECREATORS_API_KEY is missing — verdict cell degrades
// to "not measured". Each platform call is independent: a 404 or 0 results
// from one does not affect the others.
//
// Cost note: ScrapeCreators bills ~1 credit per call. A scan with a full
// identity (FB + LinkedIn links present) burns ~5 credits: Google ads, Meta
// company search, Meta ads, LinkedIn company, LinkedIn ads.

import { fetchSocialIdentity, type SocialIdentity } from './social-identity';

export interface AdsResult {
  metaActive: number | null;
  googleActive: number | null;
  linkedinActive: number | null;
  /** How each published count was identity-verified, for honest labelling. */
  verifiedBy: { meta: string | null; linkedin: string | null };
  earliestSeen: string | null;
  sampleLandingPages: string[];
  commentary: string;
}

const SC_BASE = 'https://api.scrapecreators.com/v1';
const TIMEOUT_MS = 12000;

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

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Resolve the Meta Ad Library page id from the prospect's self-declared
 *  Facebook slug (or Instagram handle as tiebreak). Exact alias match only. */
async function resolveMetaPageId(
  identity: SocialIdentity,
  headers: Record<string, string>
): Promise<{ pageId: string; matchedOn: string } | null> {
  const fbTarget = norm(identity.facebookSlug);
  const igTarget = norm(identity.instagramHandle);
  const query = identity.facebookSlug ?? identity.instagramHandle;
  if (!query) return null;
  const r = await safeJson(
    `${SC_BASE}/facebook/adLibrary/search/companies?query=${encodeURIComponent(query)}`,
    headers
  );
  if (!r.ok) return null;
  const items: any[] = r.body?.searchResults ?? r.body?.results ?? [];
  for (const c of items) {
    if (c?.page_is_deleted) continue;
    const alias = norm(c?.page_alias);
    const ig = norm(c?.ig_username);
    if (fbTarget && alias && alias === fbTarget) {
      return { pageId: String(c.page_id), matchedOn: `facebook.com/${identity.facebookSlug}` };
    }
    if (igTarget && ig && ig === igTarget) {
      return { pageId: String(c.page_id), matchedOn: `instagram.com/${identity.instagramHandle}` };
    }
  }
  return null;
}

/** Resolve the exact LinkedIn company name from the prospect's self-declared
 *  /company/<slug> link. */
async function resolveLinkedinName(
  slug: string,
  headers: Record<string, string>
): Promise<string | null> {
  const r = await safeJson(
    `${SC_BASE}/linkedin/company?url=${encodeURIComponent(`https://www.linkedin.com/company/${slug}`)}`,
    headers
  );
  if (!r.ok) return null;
  const name = r.body?.name ?? r.body?.companyName ?? null;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** Count LinkedIn ads whose advertiser matches the verified company name. */
function countLinkedinVerified(resp: SCResponse, companyName: string): number | null {
  if (!resp.ok) return null;
  const ads: any[] = resp.body?.ads ?? resp.body?.results ?? [];
  const target = norm(companyName);
  if (ads.length === 0) {
    // Zero results for a verified name is a real zero.
    return typeof resp.body?.searchResultsCount === 'number' && resp.body.searchResultsCount === 0 ? 0 : 0;
  }
  const matching = ads.filter((a) => {
    const adv = a?.advertiser?.name ?? a?.advertiser ?? a?.companyName;
    return norm(adv) === target;
  });
  // If every returned ad matches the verified advertiser, trust the API's
  // total (the array is one page); otherwise count only exact matches.
  if (matching.length === ads.length && typeof resp.body?.searchResultsCount === 'number') {
    return resp.body.searchResultsCount;
  }
  return matching.length;
}

export async function checkAds(
  hostname: string,
  identityIn?: SocialIdentity | null
): Promise<AdsResult | null> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return null;

  const headers = { 'x-api-key': apiKey };
  const identity = identityIn ?? (await fetchSocialIdentity(hostname));

  const googleUrl = `${SC_BASE}/google/company/ads?domain=${encodeURIComponent(hostname)}&region=US`;

  const [googleResp, metaPage, linkedinName] = await Promise.all([
    safeJson(googleUrl, headers),
    resolveMetaPageId(identity, headers),
    identity.linkedinSlug ? resolveLinkedinName(identity.linkedinSlug, headers) : Promise.resolve(null),
  ]);

  const [metaResp, linkedinResp] = await Promise.all([
    metaPage
      ? safeJson(
          `${SC_BASE}/facebook/adLibrary/company/ads?pageId=${encodeURIComponent(metaPage.pageId)}&country=US&status=ACTIVE&trim=true`,
          headers
        )
      : Promise.resolve(null),
    linkedinName
      ? safeJson(
          `${SC_BASE}/linkedin/ads/search?company=${encodeURIComponent(linkedinName)}&countries=US`,
          headers
        )
      : Promise.resolve(null),
  ]);

  // Log credit/auth failures loudly so they don't silently corrupt audit output.
  for (const [name, r] of [['google', googleResp], ['meta', metaResp], ['linkedin', linkedinResp]] as const) {
    if (r && !r.ok && (r.error === 'credits' || r.error === 'auth')) {
      console.error(`[ads-check] ${name} call failed: ${r.error} - ${r.message}`);
    }
  }

  const googleActive = countResults(googleResp);
  const metaActive = metaResp ? countResults(metaResp) : null;
  const linkedinActive =
    linkedinResp && linkedinName ? countLinkedinVerified(linkedinResp, linkedinName) : null;

  const earliestSeen = metaResp?.ok ? extractEarliest(metaResp.body) : null;
  const sampleLandingPages = metaResp?.ok ? extractMetaLandingPages(metaResp.body) : [];

  // Google is the anchor signal (domain-keyed). If it errored AND nothing else
  // verified, the ads check is unreliable - return null so the verdict cell
  // degrades to "not measured" rather than a misleading "no ads found".
  if (googleActive === null && metaActive === null && linkedinActive === null) {
    console.error(`[ads-check] no ad platform returned a trustworthy result for ${hostname}`);
    return null;
  }

  const parts: string[] = [];
  if (googleActive !== null) parts.push(`Google ${googleActive}`);
  if (metaActive !== null) parts.push(`Meta ${metaActive} (page-verified)`);
  if (linkedinActive !== null) parts.push(`LinkedIn ${linkedinActive} (company-verified)`);
  const total = (googleActive ?? 0) + (metaActive ?? 0) + (linkedinActive ?? 0);
  const commentary =
    total === 0
      ? `No active paid ads detected for ${hostname} across ${parts.length > 1 ? 'the verified ad libraries' : 'the Google ad library'} (${parts.join(', ')}).`
      : `${total} active paid ${total === 1 ? 'ad' : 'ads'} detected for ${hostname} (${parts.join(', ')}).`;

  return {
    metaActive,
    googleActive,
    linkedinActive,
    verifiedBy: {
      meta: metaPage?.matchedOn ?? null,
      linkedin: linkedinName ? `linkedin.com/company/${identity.linkedinSlug}` : null,
    },
    earliestSeen,
    sampleLandingPages,
    commentary,
  };
}

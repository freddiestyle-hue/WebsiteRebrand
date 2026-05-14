// Ads-running check via ScrapeCreators.
//
// Queries the Meta Ad Library for active ads run by the target company.
// Returns null if no SCRAPECREATORS_API_KEY is set — the verdict cell
// degrades to "not measured · needs SCRAPECREATORS_API_KEY".
//
// Same API surface as `_scrapecreators_meta_ads` in the Python pipeline
// (prospect-teardown/teardown/enrichers.py), so memos generated either
// way agree about ad activity.
//
// The "company name" is inferred from the domain since we don't have a
// real company name in the live form path. ScrapeCreators searches by
// fuzzy company name match, so e.g. "pellaofcolumbus.com" → search query
// "pellaofcolumbus" works reasonably well for most operator sites.

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

export async function checkAds(hostname: string): Promise<AdsResult | null> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) return null;

  const company = companyNameFromHostname(hostname);
  const headers = { 'x-api-key': apiKey };

  const metaUrl =
    `${SC_BASE}/facebook/adLibrary/company/ads?companyName=${encodeURIComponent(company)}` +
    `&country=US&status=ACTIVE&trim=true`;
  const googleUrl = `${SC_BASE}/google/company/ads?domain=${encodeURIComponent(hostname)}&region=US`;

  const [metaJson, googleJson] = await Promise.all([
    safeJson(metaUrl, headers),
    safeJson(googleUrl, headers),
  ]);

  const metaResults = (metaJson?.results ?? []) as Array<{
    id?: string;
    page_id?: string;
    snapshot?: { link_url?: string };
    snapshotUrl?: string;
    started_running?: string;
  }>;
  const googleResults = (googleJson?.results ?? googleJson?.ads ?? []) as Array<any>;

  const metaActive = metaResults.length;
  const googleActive = googleResults.length;

  // Earliest first-seen
  const allDates = metaResults
    .map((r) => r.started_running)
    .filter((d): d is string => typeof d === 'string')
    .sort();
  const earliestSeen = allDates[0] ?? null;

  // Sample LPs (de-dupe, max 3)
  const lps = new Set<string>();
  for (const r of metaResults) {
    const lp = r.snapshot?.link_url ?? r.snapshotUrl;
    if (lp && lps.size < 3) lps.add(lp);
  }

  let commentary = '';
  if (metaActive === 0 && googleActive === 0) {
    commentary = `No active paid ads detected for ${hostname} on Meta or Google.`;
  } else {
    const parts: string[] = [];
    if (metaActive > 0) parts.push(`${metaActive} active ${metaActive === 1 ? 'ad' : 'ads'} on Meta`);
    if (googleActive > 0)
      parts.push(`${googleActive} active ${googleActive === 1 ? 'ad' : 'ads'} on Google`);
    commentary = parts.join(', ') + '.';
    if (earliestSeen) commentary += ` Earliest creative dates back to ${earliestSeen}.`;
  }

  return {
    metaActive,
    googleActive,
    linkedinActive: null,
    earliestSeen,
    sampleLandingPages: [...lps],
    commentary,
  };
}

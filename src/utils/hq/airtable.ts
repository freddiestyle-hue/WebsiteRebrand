// Airtable prospect lookup for HQ.
//
// Pulls the active prospects from the Advertisers table and indexes them by
// the slug embedded in their Audit URL field. Lets the HQ page show real
// names, emails, and LinkedIn URLs next to engagement signals so Fred can
// follow up without crossing reference between tabs.
//
// Config: AIRTABLE_PAT env var holds the personal access token. Base + table
// names are hardcoded since they're stable. If the PAT is missing, this
// module returns an empty map and the HQ degrades to slug-only display.
//
// Caching: 30-min Redis TTL keyed by version. Airtable rate limits at 5
// req/sec; we don't want to repaginate on every HQ render. A 30-min stale
// window is fine — Fred edits Airtable once per outreach batch, not
// continuously.

import { Redis } from '@upstash/redis';

const BASE_ID = 'appgYU8VToutChjSi';
const TABLE = 'Advertisers';
const FIELDS = [
  'First Name',
  'Title',
  'Company',
  'Email',
  'LinkedIn URL',
  'Audit URL',
  'Outreach Stage',
  'Industry',
];
const CACHE_KEY = 'hq:airtable:prospects:v1';
const CACHE_TTL_SECONDS = 1800; // 30 min

export interface ProspectInfo {
  slug: string;
  firstName: string;       // Airtable "First Name" - the only name field that exists
  title: string;           // Airtable "Title" - job title (CEO, VP, etc.)
  company: string;
  industry: string;
  email: string;
  linkedinUrl: string;
  outreachStage: string;
  recordId: string;
  // Convenience field for display: firstName, falls back to slug if missing.
  displayName: string;
}

let _redis: Redis | null = null;
let _redisDisabled = false;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  if (_redisDisabled) return null;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    _redisDisabled = true;
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Returns a Map of slug → ProspectInfo for every Advertiser record whose
 * Audit URL parses to a recognisable slug. Returns an empty Map (not an
 * error) if AIRTABLE_PAT is missing — HQ should still render.
 */
export async function getProspectsBySlug(): Promise<Map<string, ProspectInfo>> {
  const redis = getRedis();
  // Try cache first.
  if (redis) {
    try {
      const hit = await redis.get<ProspectInfo[]>(CACHE_KEY);
      if (hit && Array.isArray(hit)) {
        return new Map(hit.map((p) => [p.slug, p]));
      }
    } catch (e) {
      console.warn('[hq airtable] cache read failed', e);
    }
  }

  const pat = (process.env.AIRTABLE_PAT || '').trim();
  if (!pat) {
    // No PAT configured — graceful no-op. HQ stays slug-only.
    return new Map();
  }

  let records: AirtableRecord[];
  try {
    records = await fetchAllRecords(pat);
  } catch (e) {
    console.warn('[hq airtable] fetch failed', e);
    return new Map();
  }

  const prospects: ProspectInfo[] = [];
  for (const rec of records) {
    const info = toProspectInfo(rec);
    if (info) prospects.push(info);
  }

  if (redis) {
    redis.set(CACHE_KEY, prospects, { ex: CACHE_TTL_SECONDS }).catch((e) => {
      console.warn('[hq airtable] cache write failed', e);
    });
  }

  return new Map(prospects.map((p) => [p.slug, p]));
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

async function fetchAllRecords(pat: string): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;
  let pages = 0;
  const MAX_PAGES = 20; // 100 per page × 20 = 2000, well above the 416 active list

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`);
    for (const f of FIELDS) url.searchParams.append('fields[]', f);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (!res.ok) {
      throw new Error(`Airtable ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { records?: AirtableRecord[]; offset?: string };
    if (data.records) all.push(...data.records);
    offset = data.offset;
    pages += 1;
  } while (offset && pages < MAX_PAGES);

  return all;
}

function toProspectInfo(rec: AirtableRecord): ProspectInfo | null {
  const f = rec.fields || {};
  const auditUrl = String(f['Audit URL'] || '').trim();
  const slug = extractSlug(auditUrl);
  if (!slug) return null;

  const firstName = String(f['First Name'] || '').trim();
  const title = String(f['Title'] || '').trim();
  const company = String(f['Company'] || '').trim();
  const displayName = firstName || slug;

  return {
    slug,
    firstName,
    title,
    company,
    industry: String(f['Industry'] || '').trim(),
    email: String(f['Email'] || '').trim(),
    linkedinUrl: String(f['LinkedIn URL'] || '').trim(),
    outreachStage: String(f['Outreach Stage'] || '').trim(),
    recordId: rec.id,
    displayName,
  };
}

/**
 * Extract the prospect slug from an audit URL.
 * Handles:
 *   https://rivett.tech/audit/v3/<slug>
 *   https://rivett.tech/audit/p/<slug>
 *   /audit/v3/<slug>
 *   <slug>  (already bare)
 */
function extractSlug(auditUrl: string): string | null {
  if (!auditUrl) return null;
  const m = auditUrl.match(/\/audit\/(?:v3|p)\/([^/?#]+)/);
  if (m) return m[1];
  // If it looks like a bare slug already (no slashes, has at least one hyphen)
  if (!auditUrl.includes('/') && auditUrl.includes('-')) return auditUrl;
  return null;
}

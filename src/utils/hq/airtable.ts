// Airtable prospect lookup for HQ - one unified table.
//
// As of 2026-05-27 there is a single `Prospects` table in base
// `appgYU8VToutChjSi`. The Vertical singleSelect (Advertiser, Mental Health,
// Homecare, Fractional Role) drives per-play context. Adding a new vertical
// = add an option to the singleSelect, no schema or code change.
//
// Config: AIRTABLE_PAT env var. Base + table hardcoded. If PAT is missing
// the map comes back empty and HQ degrades to slug-only.
//
// Caching: 30-min Redis TTL on the full prospect map.

import { Redis } from '@upstash/redis';

const BASE_ID = 'appgYU8VToutChjSi';
const TABLE = 'Prospects';

// Field names match the unified schema. All are optional except Audit URL
// (the slug join key); fields are pulled into ProspectInfo when present.
const FIELDS = [
  // Core
  'Company', 'Domain', 'URL', 'First Name', 'Title', 'Industry',
  'Email', 'LinkedIn URL', 'Audit URL', 'Audit Score',
  'Outreach Stage', 'LinkedIn DM', 'LinkedIn Follow-up DM',
  'Email Subject', 'Email Body', 'Sent At', 'Replied At', 'Notes',
  // Vertical
  'Vertical',
  // Shared audit findings
  'SEO Finding', 'AEO Finding', 'Pagespeed Finding', 'Tracking Finding',
  'Ads Finding', 'Conversion Finding', 'Mobile Finding', 'Email Finding',
  'Stack Finding',
  // Advertiser-specific
  'Total Ads', 'Meta Ads', 'Google Ads', 'LinkedIn Ads',
  'Hero Dimension', 'Attack Wave', 'Priority', 'Score',
  // Mental Health-specific
  'Intake Tool', 'Path to Booking', 'Form Length', 'Mobile Experience',
  'Response Promise', 'Booking Method', 'Cost Transparency',
  'Trust Signals', 'Contact Options', 'Patient Matching', 'Lead Recovery',
  // Fractional/Homecare-specific
  'Role Title', 'Salary Min', 'Salary Max', 'Work Arrangement',
  'Apply URL', 'Job URL', 'Fit Score', 'Job Description', 'Posted Date',
];

// Per-vertical audit-finding field lists used to build the freeform
// `auditContext` string that the LLM treats as a hook source.
const FINDING_FIELDS_BY_VERTICAL: Record<string, string[]> = {
  'Advertiser': [
    'SEO Finding', 'AEO Finding', 'Pagespeed Finding', 'Tracking Finding',
    'Ads Finding', 'Conversion Finding', 'Mobile Finding', 'Email Finding',
    'Stack Finding', 'Hero Dimension', 'Attack Wave',
  ],
  'Mental Health': [
    'Path to Booking', 'Form Length', 'Mobile Experience',
    'Response Promise', 'Booking Method', 'Cost Transparency',
    'Trust Signals', 'Contact Options', 'Patient Matching',
    'Lead Recovery', 'Intake Tool',
  ],
  'Fractional Role': [
    'SEO Finding', 'AEO Finding', 'Pagespeed Finding', 'Tracking Finding',
    'Ads Finding', 'Conversion Finding', 'Mobile Finding', 'Email Finding',
    'Stack Finding', 'Role Title', 'Work Arrangement', 'Salary Min', 'Salary Max',
  ],
  'Homecare': [
    'SEO Finding', 'AEO Finding', 'Pagespeed Finding', 'Tracking Finding',
    'Ads Finding', 'Conversion Finding', 'Mobile Finding', 'Email Finding',
    'Stack Finding', 'Role Title', 'Work Arrangement',
  ],
};

const CACHE_KEY = 'hq:airtable:prospects:v6';
const CACHE_TTL_SECONDS = 1800;

export type Vertical = 'Advertiser' | 'Mental Health' | 'Homecare' | 'Fractional Role';

export interface ProspectInfo {
  slug: string;
  vertical: Vertical | '';
  /** Display source — same as vertical for backward compatibility with old UI. */
  source: string;
  displayName: string;
  firstName: string;
  title: string;
  company: string;
  industry: string;
  email: string;
  linkedinUrl: string;
  outreachStage: string;
  /** Canned LinkedIn intro DM (style anchor for LLM). */
  linkedinDm: string;
  /** Canned post-engagement LinkedIn follow-up. */
  linkedinFollowupDm: string;
  /** Canned email subject. */
  emailSubject: string;
  /** Canned email body. */
  emailBody: string;
  /** Concatenated audit findings, freeform context for LLM hooks. */
  auditContext: string;
  /** Convenience: when we sent them something. ISO date string or ''. */
  sentAt: string;
  /** When they replied, if at all. */
  repliedAt: string;
  recordId: string;
  /** Attack Wave tag, e.g. "Wave 1 - This Week" / "Wave 2 - This Week". */
  attackWave: string;
  /** Priority tier string, e.g. "A+ #13" / "B #245". */
  priority: string;
  /** Audit URL, kept on the info so the outreach queue can render it directly. */
  auditUrl: string;
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
 * Returns slug → ProspectInfo from the unified Prospects table. First slug
 * match wins if duplicates exist.
 */
export async function getProspectsBySlug(): Promise<Map<string, ProspectInfo>> {
  const redis = getRedis();
  if (redis) {
    try {
      const hit = await redis.get<ProspectInfo[]>(CACHE_KEY);
      if (hit && Array.isArray(hit)) return mapByFirstSlug(hit);
    } catch (e) {
      console.warn('[hq airtable] cache read failed', e);
    }
  }

  const pat = (process.env.AIRTABLE_PAT || '').trim();
  if (!pat) return new Map();

  let records: AirtableRecord[];
  try {
    records = await fetchAll(pat);
  } catch (e) {
    console.warn('[hq airtable] fetch failed', e);
    return new Map();
  }

  const prospects: ProspectInfo[] = [];
  for (const rec of records) {
    const info = recordToInfo(rec);
    if (info) prospects.push(info);
  }

  if (redis) {
    redis.set(CACHE_KEY, prospects, { ex: CACHE_TTL_SECONDS }).catch((e) => {
      console.warn('[hq airtable] cache write failed', e);
    });
  }

  return mapByFirstSlug(prospects);
}

/** Single-prospect lookup. Used by the LLM draft endpoint. */
export async function getProspectBySlug(slug: string): Promise<ProspectInfo | null> {
  const map = await getProspectsBySlug();
  return map.get(slug) || null;
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

async function fetchAll(pat: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  let pages = 0;
  const MAX_PAGES = 50; // 100 per page × 50 = 5000, comfortable headroom

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`);
    for (const fn of FIELDS) url.searchParams.append('fields[]', fn);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (!res.ok) {
      throw new Error(`Airtable ${TABLE} ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { records?: AirtableRecord[]; offset?: string };
    if (data.records) records.push(...data.records);
    offset = data.offset;
    pages += 1;
  } while (offset && pages < MAX_PAGES);

  return records;
}

function recordToInfo(rec: AirtableRecord): ProspectInfo | null {
  const f = rec.fields || {};
  const auditUrl = String(f['Audit URL'] || '').trim();
  const slug = extractSlug(auditUrl);
  if (!slug) return null;

  const firstName = String(f['First Name'] || '').trim();
  const title = String(f['Title'] || '').trim();
  const company = String(f['Company'] || '').trim();
  const vertical = (String(f['Vertical'] || '').trim() || '') as ProspectInfo['vertical'];

  // Build the audit context string. Pull per-vertical finding fields plus any
  // value in Notes (which carries Hero One-Liner / Audit Teardown legacy data
  // for migrated Advertiser records).
  const findings: string[] = [];
  const findingFields = vertical && FINDING_FIELDS_BY_VERTICAL[vertical] ? FINDING_FIELDS_BY_VERTICAL[vertical] : [];
  for (const fn of findingFields) {
    const v = f[fn];
    if (v == null) continue;
    const sv = String(v).trim();
    if (sv) findings.push(`${fn}: ${sv}`);
  }
  const notes = String(f['Notes'] || '').trim();
  if (notes) findings.push(`Notes: ${notes}`);
  const auditContext = findings.join('\n\n');

  const displayName = firstName || (company ? `${company} (no contact)` : slug);

  return {
    slug,
    vertical: vertical,
    source: vertical || 'Prospects',
    displayName,
    firstName,
    title,
    company,
    industry: String(f['Industry'] || '').trim(),
    email: String(f['Email'] || '').trim(),
    linkedinUrl: String(f['LinkedIn URL'] || '').trim(),
    outreachStage: String(f['Outreach Stage'] || '').trim(),
    linkedinDm: String(f['LinkedIn DM'] || '').trim(),
    linkedinFollowupDm: String(f['LinkedIn Follow-up DM'] || '').trim(),
    emailSubject: String(f['Email Subject'] || '').trim(),
    emailBody: String(f['Email Body'] || '').trim(),
    auditContext,
    sentAt: String(f['Sent At'] || '').trim(),
    repliedAt: String(f['Replied At'] || '').trim(),
    recordId: rec.id,
    attackWave: String(f['Attack Wave'] || '').trim(),
    priority: String(f['Priority'] || '').trim(),
    auditUrl,
  };
}

// --------------------------------------------------------------------------
// Outreach queue — surfaced in the new HQ Send Queue component.
// --------------------------------------------------------------------------

export interface OutreachQueueRow {
  recordId: string;
  slug: string;
  firstName: string;
  displayName: string;
  title: string;
  company: string;
  industry: string;
  linkedinUrl: string;
  linkedinDm: string;
  auditUrl: string;
  attackWave: string;
  priority: string;
  outreachStage: string;
}

/**
 * Returns the prospects ready to send for a given Attack Wave - filtered to
 * unsent rows with a LinkedIn URL and a populated LinkedIn DM. Ordered by
 * Priority (A+ first, then A, B, C) and then by record id for stability.
 *
 * Reads from the same cached Prospects pull that getProspectsBySlug uses,
 * so the queue stays in sync with the Action Queue / Top Prospects views.
 */
export async function getOutreachQueueByWave(wave: string): Promise<OutreachQueueRow[]> {
  const all = await getProspectsBySlug();
  const queue: OutreachQueueRow[] = [];
  for (const info of all.values()) {
    if (!info.attackWave) continue;
    if (info.attackWave !== wave) continue;
    // ONLY show prospects at "Not Sent". Anything else - Drafted, Connection
    // Sent, Sent, Replied, Disqualified, etc - is considered actioned and
    // should not reappear in the Send Queue. The Send button's PATCH writes
    // "Connection Sent" via /api/hq/mark-messaged, which is what drops the
    // row out on next render. "Drafted" used to be included here but nothing
    // in the codebase writes it - records at "Drafted" got there by manual
    // edits in Airtable, and they were not "ready to send" in the way the
    // queue intends. Fred's rule: click Send = reached out = out of the queue.
    if (info.outreachStage && info.outreachStage !== 'Not Sent') continue;
    if (!info.linkedinUrl) continue;
    if (!info.linkedinDm) continue;
    queue.push({
      recordId: info.recordId,
      slug: info.slug,
      firstName: info.firstName,
      displayName: info.displayName,
      title: info.title,
      company: info.company,
      industry: info.industry,
      linkedinUrl: info.linkedinUrl,
      linkedinDm: info.linkedinDm,
      auditUrl: info.auditUrl,
      attackWave: info.attackWave,
      priority: info.priority,
      outreachStage: info.outreachStage,
    });
  }
  // Priority tier (A+ best, then A, B, C, D, anything else last) then record id.
  const tierRank = (p: string): number => {
    const m = p.match(/^(A\+|A|B|C|D)\b/);
    if (!m) return 5;
    return { 'A+': 0, A: 1, B: 2, C: 3, D: 4 }[m[1] as 'A+' | 'A' | 'B' | 'C' | 'D'];
  };
  queue.sort((a, b) => {
    const ra = tierRank(a.priority);
    const rb = tierRank(b.priority);
    if (ra !== rb) return ra - rb;
    return a.recordId.localeCompare(b.recordId);
  });
  return queue;
}

/**
 * Update a single prospect's Outreach Stage. Used by /api/hq/mark-messaged
 * so Airtable is the single source of truth for outreach state.
 */
export async function setOutreachStage(
  recordId: string,
  stage: string
): Promise<boolean> {
  const pat = (process.env.AIRTABLE_PAT || '').trim();
  if (!pat || !recordId) return false;
  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${recordId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pat}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fields: { 'Outreach Stage': stage }, typecast: true }),
    });
    if (!res.ok) {
      console.warn('[hq airtable] setOutreachStage failed', res.status, await res.text());
      return false;
    }
    // Invalidate the cache so the next /hq render sees the change.
    const redis = getRedis();
    if (redis) {
      redis.del(CACHE_KEY).catch(() => {});
    }
    return true;
  } catch (e) {
    console.warn('[hq airtable] setOutreachStage threw', e);
    return false;
  }
}

/**
 * Extract the prospect slug from an audit URL. Must match PROSPECT_SLUG_EXPR
 * in posthog/query.ts so the slug-join lines up with what PostHog stores as
 * the prospect identifier for visitor traffic.
 *   https://rivett.tech/audit/v3/<slug>
 *   https://rivett.tech/audit/p/<slug>
 *   https://intake-reviews.vercel.app/intake-review/<slug>
 *   /audit/v3/<slug>
 *   /intake-review/<slug>
 *   <slug>  (already bare)
 */
function extractSlug(auditUrl: string): string | null {
  if (!auditUrl) return null;
  const m = auditUrl.match(/\/(?:audit\/(?:v3|p)|intake-review)\/([^/?#]+)/);
  if (m) return m[1].replace(/[\s./]+$/, '');
  if (!auditUrl.includes('/') && auditUrl.includes('-')) return auditUrl;
  return null;
}

function mapByFirstSlug(rows: ProspectInfo[]): Map<string, ProspectInfo> {
  const map = new Map<string, ProspectInfo>();
  for (const r of rows) {
    if (!map.has(r.slug)) map.set(r.slug, r);
  }
  return map;
}

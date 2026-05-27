// Airtable prospect lookup for HQ - multi-table, one canonical schema.
//
// The base `appgYU8VToutChjSi` hosts every Rivett prospecting play in its
// own table. As of the 2026-05-27 normalization, every prospecting table
// conforms to one shared schema, so this module reads them all the same way.
//
// Canonical fields each prospecting table must have:
//   First Name, Title, Company, Industry, Email, LinkedIn URL, Audit URL,
//   Outreach Stage, LinkedIn DM
// Optional canonical fields (read if present, blank if absent):
//   LinkedIn Follow-up DM, Email Subject, Email Body
//
// To add a new play: create the table with these field names. No code change.
//
// Caching: 30-min Redis TTL on the full prospect map.

import { Redis } from '@upstash/redis';

const BASE_ID = 'appgYU8VToutChjSi';

// Tables to read. Add new plays here.
const TABLES: string[] = [
  'Advertisers',
  'Fractional Roles',
  'Private pay homecare',
  'Mental Health',
];

// Canonical field names - same across every prospecting table.
const FIELD = {
  firstName: 'First Name',
  title: 'Title',
  company: 'Company',
  industry: 'Industry',
  email: 'Email',
  linkedinUrl: 'LinkedIn URL',
  auditUrl: 'Audit URL',
  outreachStage: 'Outreach Stage',
  linkedinDm: 'LinkedIn DM',
  linkedinFollowupDm: 'LinkedIn Follow-up DM',
  emailSubject: 'Email Subject',
  emailBody: 'Email Body',
} as const;

// Play-specific audit-finding fields. These are not part of the canonical
// schema since each play audits something different. We read them as freeform
// context for the LLM to use as message hooks.
const AUDIT_FINDING_FIELDS_BY_TABLE: Record<string, string[]> = {
  'Advertisers': ['Hero One-Liner', 'Hero Dimension', 'Tech Stack Opportunity'],
  'Fractional Roles': [
    'Hero Gap', 'SEO Finding', 'AEO Finding', 'Pagespeed Finding',
    'Tracking Finding', 'Ads Finding', 'Conversion Finding',
    'Mobile Finding', 'Email Finding', 'Stack Finding',
  ],
  'Private pay homecare': [
    'Hero Gap', 'SEO Finding', 'AEO Finding', 'Pagespeed Finding',
    'Tracking Finding', 'Ads Finding', 'Conversion Finding',
    'Mobile Finding', 'Email Finding', 'Stack Finding',
  ],
  'Mental Health': [
    'Hero Gap', 'Summary', 'Path to Booking', 'Form Length',
    'Mobile Experience', 'Response Promise', 'Booking Method',
    'Cost Transparency', 'Trust Signals', 'Contact Options',
    'Patient Matching', 'Lead Recovery',
  ],
};

const CACHE_KEY = 'hq:airtable:prospects:v3';
const CACHE_TTL_SECONDS = 1800;

export interface ProspectInfo {
  slug: string;
  source: string;       // which table they came from (the play name)
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
  /** Canned post-engagement LinkedIn follow-up DM. */
  linkedinFollowupDm: string;
  /** Canned email subject. */
  emailSubject: string;
  /** Canned email body. */
  emailBody: string;
  /** Play-specific audit findings concatenated as freeform context. */
  auditContext: string;
  recordId: string;
  tableName: string;
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
 * Returns slug → ProspectInfo across every prospecting table in the base.
 * If two tables both contain a record for the same slug, the first match wins
 * (TABLES order determines priority).
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

  const allRecords: ProspectInfo[] = [];

  // Read every table in parallel.
  const results = await Promise.allSettled(
    TABLES.map((tableName) => fetchTable(tableName, pat))
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const tableName = TABLES[i];
    if (r.status === 'fulfilled') {
      allRecords.push(...r.value);
    } else {
      console.warn(`[hq airtable] table ${tableName} failed`, r.reason);
    }
  }

  if (redis) {
    redis.set(CACHE_KEY, allRecords, { ex: CACHE_TTL_SECONDS }).catch((e) => {
      console.warn('[hq airtable] cache write failed', e);
    });
  }

  return mapByFirstSlug(allRecords);
}

/**
 * Get a single prospect's info by slug. Used by the LLM draft endpoint
 * when generating one message at a time.
 */
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

async function fetchTable(tableName: string, pat: string): Promise<ProspectInfo[]> {
  // We request only the fields we'll read. Asking for a non-existent field
  // makes Airtable return 0 records, so the canonical list is the safe set.
  // Audit-finding fields vary per table - only request the ones we know exist
  // for this specific table.
  const wanted = new Set<string>([
    FIELD.firstName, FIELD.title, FIELD.company, FIELD.industry, FIELD.email,
    FIELD.linkedinUrl, FIELD.auditUrl, FIELD.outreachStage, FIELD.linkedinDm,
  ]);
  // Optional canonical fields - check the table schema before adding. For now,
  // try to request them; if any are missing we'll get a 422 and retry without.
  // Simpler: add them and let Airtable strip the absent ones from response.
  // Actually Airtable errors on unknown fields, so we have to be precise.
  // Mental Health has Follow-up + Email Subject + Email Body.
  // Advertisers has only LinkedIn Follow-up DM.
  // Fractional / Private pay has Email Subject + Email Body but no Follow-up.
  // To avoid 0-record bugs, check per-table presence:
  const OPTIONAL_BY_TABLE: Record<string, string[]> = {
    'Advertisers': [FIELD.linkedinFollowupDm],
    'Fractional Roles': [FIELD.emailSubject, FIELD.emailBody],
    'Private pay homecare': [FIELD.emailSubject, FIELD.emailBody],
    'Mental Health': [FIELD.linkedinFollowupDm, FIELD.emailSubject, FIELD.emailBody],
  };
  for (const f of OPTIONAL_BY_TABLE[tableName] || []) wanted.add(f);
  for (const f of AUDIT_FINDING_FIELDS_BY_TABLE[tableName] || []) wanted.add(f);

  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  let pages = 0;
  const MAX_PAGES = 20;

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(tableName)}`);
    for (const fn of wanted) url.searchParams.append('fields[]', fn);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat}` },
    });
    if (!res.ok) {
      throw new Error(`Airtable ${tableName} ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { records?: AirtableRecord[]; offset?: string };
    if (data.records) records.push(...data.records);
    offset = data.offset;
    pages += 1;
  } while (offset && pages < MAX_PAGES);

  const out: ProspectInfo[] = [];
  for (const rec of records) {
    const info = recordToInfo(rec, tableName);
    if (info) out.push(info);
  }
  return out;
}

function recordToInfo(rec: AirtableRecord, tableName: string): ProspectInfo | null {
  const f = rec.fields || {};
  const auditUrl = String(f[FIELD.auditUrl] || '').trim();
  const slug = extractSlug(auditUrl);
  if (!slug) return null;

  const firstName = String(f[FIELD.firstName] || '').trim();
  const title = String(f[FIELD.title] || '').trim();
  const company = String(f[FIELD.company] || '').trim();

  // Concatenate whichever audit-finding fields this table has.
  const findings: string[] = [];
  for (const fn of AUDIT_FINDING_FIELDS_BY_TABLE[tableName] || []) {
    const v = String(f[fn] || '').trim();
    if (v) findings.push(`${fn}: ${v}`);
  }
  const auditContext = findings.join('\n\n');

  const displayName = firstName || (company ? `${company} (no contact)` : slug);

  return {
    slug,
    source: tableName,
    displayName,
    firstName,
    title,
    company,
    industry: String(f[FIELD.industry] || '').trim(),
    email: String(f[FIELD.email] || '').trim(),
    linkedinUrl: String(f[FIELD.linkedinUrl] || '').trim(),
    outreachStage: String(f[FIELD.outreachStage] || '').trim(),
    linkedinDm: String(f[FIELD.linkedinDm] || '').trim(),
    linkedinFollowupDm: String(f[FIELD.linkedinFollowupDm] || '').trim(),
    emailSubject: String(f[FIELD.emailSubject] || '').trim(),
    emailBody: String(f[FIELD.emailBody] || '').trim(),
    auditContext,
    recordId: rec.id,
    tableName,
  };
}

/**
 * Extract the prospect slug from an audit URL.
 *   https://rivett.tech/audit/v3/<slug>
 *   https://rivett.tech/audit/p/<slug>
 *   /audit/v3/<slug>
 *   <slug>  (already bare)
 */
function extractSlug(auditUrl: string): string | null {
  if (!auditUrl) return null;
  const m = auditUrl.match(/\/audit\/(?:v3|p)\/([^/?#]+)/);
  if (m) return m[1];
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

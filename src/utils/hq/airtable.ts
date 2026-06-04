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
  // Engagement (synced from Instantly /api/cron/sync-instantly)
  'Opens', 'Clicks', 'Replies', 'Last Engaged At', 'Instantly Lead ID',
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

// v9: added Opens / Clicks / Replies / Last Engaged At / Instantly Lead ID.
// Bump this whenever ProspectInfo gains or loses a field — old cached payloads
// will be missing the new keys, which turns numeric math into NaN downstream.
const CACHE_KEY = 'hq:airtable:prospects:v9';
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
  /** Email open count from Instantly. NOTE: includes Instantly's own URL pre-scanner. */
  opens: number;
  /** Email click count from Instantly. Inflated by Instantly's proxaction.com link wrapper - cross-reference PostHog short_link_clicked uniques for human-only. */
  clicks: number;
  /** Email reply count from Instantly. */
  replies: number;
  /** Most recent open/click/reply timestamp from Instantly (ISO). */
  lastEngagedAt: string;
  /** Instantly lead UUID, used to identify the same lead across syncs. */
  instantlyLeadId: string;
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
  // Slug join key. Prefer the slug embedded in the Audit URL (so PostHog
  // engagement joins work). Fall back to a synthetic slug derived from the
  // Domain field so prospects without an audit still surface in the HQ
  // backlog - they just won't have engagement signals attached. This lets
  // the "fix the backlog" view include the 74 migrated records (and any
  // future un-audited rows) instead of silently dropping them.
  let slug = extractSlug(auditUrl);
  if (!slug) {
    const domain = String(f['Domain'] || '').trim().toLowerCase();
    if (domain) slug = domain.replace(/\./g, '-').replace(/[^a-z0-9-]/g, '');
  }
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
    opens: numberField(f['Opens']),
    clicks: numberField(f['Clicks']),
    replies: numberField(f['Replies']),
    lastEngagedAt: String(f['Last Engaged At'] || '').trim(),
    instantlyLeadId: String(f['Instantly Lead ID'] || '').trim(),
  };
}

function numberField(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
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
 * Options for `getOutreachQueueByWave`. Defaults match the original wave-scoped
 * "send queue" semantics; pass `wave: null` and relax the gates to surface the
 * full unreached backlog.
 */
export interface OutreachQueueOptions {
  /** Wave to scope to. `null` returns all waves AND prospects with no wave assigned. */
  wave?: string | null;
  /** When true, also includes prospects at stage "Drafted" (copy written, never sent). */
  includeDrafted?: boolean;
  /** When true, also includes "Connection Sent" + "Sent" (in-flight; chase / follow up). */
  includeInFlight?: boolean;
  /** When true, the queue only includes rows with a populated LinkedIn DM. */
  requireDm?: boolean;
  /** When true (default), the queue only includes rows with a LinkedIn URL. */
  requireLinkedinUrl?: boolean;
}

/**
 * Returns the prospects ready to send. Defaults to the strict wave-scoped
 * queue (Not Sent + LinkedIn URL + LinkedIn DM, single wave). Callers can pass
 * an options object to surface the full backlog instead - drop the wave gate,
 * include "Drafted" rows, and allow rows without a generated DM (the cockpit's
 * Send button auto-disables when DM is missing, prompting the "Draft DM" flow).
 *
 * Ordered by Priority (A+ first, then A, B, C) and then by record id for
 * stability. Reads from the same cached Prospects pull that getProspectsBySlug
 * uses, so the queue stays in sync with the Action Queue / Top Prospects views.
 */
export async function getOutreachQueueByWave(
  arg: string | OutreachQueueOptions,
): Promise<OutreachQueueRow[]> {
  const opts: Required<OutreachQueueOptions> = typeof arg === 'string'
    ? { wave: arg, includeDrafted: false, includeInFlight: false, requireDm: true, requireLinkedinUrl: true }
    : {
        wave: arg.wave ?? null,
        includeDrafted: arg.includeDrafted ?? false,
        includeInFlight: arg.includeInFlight ?? false,
        requireDm: arg.requireDm ?? true,
        requireLinkedinUrl: arg.requireLinkedinUrl ?? true,
      };

  const stageList: string[] = ['Not Sent'];
  if (opts.includeDrafted) stageList.push('Drafted');
  if (opts.includeInFlight) stageList.push('Connection Sent', 'Connection Accepted', 'Sent', 'Bumped');
  const allowedStages = new Set<string>(stageList);

  const all = await getProspectsBySlug();
  const queue: OutreachQueueRow[] = [];
  for (const info of all.values()) {
    // Wave gate: only enforced when the caller asked for a specific wave.
    // `wave: null` surfaces every prospect across all waves AND prospects
    // with no Attack Wave assigned (the migration backlog lives here).
    if (opts.wave !== null) {
      if (!info.attackWave) continue;
      if (info.attackWave !== opts.wave) continue;
    }
    // Stage gate. Always exclude Replied / Booked / Won / Lost / Disqualified
    // (deal terminal states). Optionally include Drafted (manually drafted
    // rows that never shipped) and in-flight stages (Connection Sent / Sent
    // etc. - prospect needs chasing for an accept or reply).
    const stage = info.outreachStage || 'Not Sent';
    if (!allowedStages.has(stage)) continue;
    if (opts.requireLinkedinUrl && !info.linkedinUrl) continue;
    if (opts.requireDm && !info.linkedinDm) continue;
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
 * Returns email (lowercased) → ProspectInfo. Used by the Instantly sync cron to
 * match Instantly leads back to Airtable records without a full table scan per
 * lead. Builds from the same cache as getProspectsBySlug, so it's free after
 * the first call in a request.
 */
export async function getProspectsByEmail(): Promise<Map<string, ProspectInfo>> {
  const bySlug = await getProspectsBySlug();
  const byEmail = new Map<string, ProspectInfo>();
  for (const info of bySlug.values()) {
    const email = info.email.trim().toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, info);
  }
  return byEmail;
}

/**
 * Engagement update from the Instantly sync. Writes Opens / Clicks / Replies /
 * Last Engaged At / Instantly Lead ID, and bumps Outreach Stage forward when
 * the engagement implies it (Sent → on first send; Replied → on first reply).
 *
 * Stage transitions are one-way: we never regress (a manually-set Booked stays
 * Booked even if Instantly reports a later open). Pass only the fields you want
 * written; omit a field to leave Airtable unchanged.
 */
export interface ProspectEngagementUpdate {
  recordId: string;
  opens?: number;
  clicks?: number;
  replies?: number;
  lastEngagedAt?: string; // ISO
  instantlyLeadId?: string;
  sentAt?: string; // ISO date (YYYY-MM-DD)
  repliedAt?: string; // ISO date (YYYY-MM-DD)
  /** Current outreach stage in Airtable (so we don't regress). */
  currentStage?: string;
  /** When true, has at least one email send recorded by Instantly. */
  hasBeenSent?: boolean;
  /** When true, has at least one reply recorded by Instantly. */
  hasReplied?: boolean;
}

const STAGE_RANK: Record<string, number> = {
  'Not Sent': 0,
  'Drafted': 1,
  'Connection Sent': 2,
  'Connection Accepted': 3,
  'Sent': 4,
  'Bumped': 5,
  'Replied': 6,
  'Booked': 7,
  'Won': 8,
  'Lost': 8,
  'Disqualified': 8,
};

/** Pick the higher-ranked of two stages, never regressing. */
function advanceStage(current: string, proposed: string): string {
  const c = STAGE_RANK[current] ?? 0;
  const p = STAGE_RANK[proposed] ?? 0;
  return p > c ? proposed : current;
}

export async function updateProspectEngagement(
  update: ProspectEngagementUpdate
): Promise<boolean> {
  const pat = (process.env.AIRTABLE_PAT || '').trim();
  if (!pat || !update.recordId) return false;

  const fields: Record<string, unknown> = {};
  if (typeof update.opens === 'number') fields['Opens'] = update.opens;
  if (typeof update.clicks === 'number') fields['Clicks'] = update.clicks;
  if (typeof update.replies === 'number') fields['Replies'] = update.replies;
  if (update.lastEngagedAt) fields['Last Engaged At'] = update.lastEngagedAt;
  if (update.instantlyLeadId) fields['Instantly Lead ID'] = update.instantlyLeadId;
  if (update.sentAt) fields['Sent At'] = update.sentAt;
  if (update.repliedAt) fields['Replied At'] = update.repliedAt;

  // Stage advancement: only set when we have evidence and the current stage is
  // earlier in the funnel. Manual "Booked" / "Won" never gets overwritten.
  const current = update.currentStage || 'Not Sent';
  let nextStage = current;
  if (update.hasBeenSent) nextStage = advanceStage(nextStage, 'Sent');
  if (update.hasReplied) nextStage = advanceStage(nextStage, 'Replied');
  if (nextStage !== current) fields['Outreach Stage'] = nextStage;

  if (Object.keys(fields).length === 0) return true;

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${update.recordId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pat}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!res.ok) {
      console.warn('[hq airtable] updateProspectEngagement failed', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[hq airtable] updateProspectEngagement threw', e);
    return false;
  }
}

/**
 * Batch variant - up to 10 records per PATCH per Airtable's limit. Returns the
 * number of records the API confirmed updating.
 */
export async function updateProspectEngagementBatch(
  updates: ProspectEngagementUpdate[]
): Promise<number> {
  if (updates.length === 0) return 0;
  const pat = (process.env.AIRTABLE_PAT || '').trim();
  if (!pat) return 0;

  let updated = 0;
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const records = chunk.map((u) => {
      const fields: Record<string, unknown> = {};
      if (typeof u.opens === 'number') fields['Opens'] = u.opens;
      if (typeof u.clicks === 'number') fields['Clicks'] = u.clicks;
      if (typeof u.replies === 'number') fields['Replies'] = u.replies;
      if (u.lastEngagedAt) fields['Last Engaged At'] = u.lastEngagedAt;
      if (u.instantlyLeadId) fields['Instantly Lead ID'] = u.instantlyLeadId;
      if (u.sentAt) fields['Sent At'] = u.sentAt;
      if (u.repliedAt) fields['Replied At'] = u.repliedAt;

      const current = u.currentStage || 'Not Sent';
      let nextStage = current;
      if (u.hasBeenSent) nextStage = advanceStage(nextStage, 'Sent');
      if (u.hasReplied) nextStage = advanceStage(nextStage, 'Replied');
      if (nextStage !== current) fields['Outreach Stage'] = nextStage;

      return { id: u.recordId, fields };
    }).filter((r) => Object.keys(r.fields).length > 0);

    if (records.length === 0) continue;

    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${pat}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ records, typecast: true }),
      });
      if (!res.ok) {
        console.warn('[hq airtable] batch update failed', res.status, await res.text());
        continue;
      }
      const data = (await res.json()) as { records?: unknown[] };
      updated += data.records?.length ?? 0;
    } catch (e) {
      console.warn('[hq airtable] batch update threw', e);
    }
  }

  // Bust the slug cache once at the end so the next /hq render reflects all
  // the engagement changes at once.
  const redis = getRedis();
  if (redis && updated > 0) {
    redis.del(CACHE_KEY).catch(() => {});
  }

  return updated;
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

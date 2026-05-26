// Server-side PostHog HogQL query helper used by the /hq analytics page.
//
// Authentication uses a personal API key stored as POSTHOG_PERSONAL_API_KEY.
// This MUST stay server-only. Astro will fail the build if this file is
// imported from a `client:` directive component. Never `console.log` the key.
//
// All queries exclude datacenter cities (Microsoft SafeLinks/Mimecast/etc.)
// and Fred's own home cities so the HQ page shows real prospect engagement.
//
// Caching: every query result is cached in Upstash Redis keyed by
// (queryName, fromIso, toIso). TTL varies by date-range size so "today" stays
// fresh while "all time" stays cheap. On cache miss we fetch PostHog (1-3s),
// on cache hit we read Redis (10-50ms). The /hq page hits this 10 times in
// parallel per render; warm cache turns a 2-4s render into a sub-second one.

import { Redis } from '@upstash/redis';
import { hogqlRangeClause, rangeDaysSpan, type DateRange } from './dateRange';

const POSTHOG_HOST = 'https://us.posthog.com';
const POSTHOG_PROJECT_ID = 373899;

// Cache versioning lets us bust everything by bumping this string.
const CACHE_VERSION = 'v1';

// Lazy redis client. Construction is cheap but we only need one instance.
// Use KV_REST_API_* env vars (set by Vercel KV / Upstash integration) since
// Redis.fromEnv() looks for UPSTASH_REDIS_REST_* which aren't set here.
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

// TTL in seconds. Stretched longer than ideal-freshness so the daily cron
// pre-warm + sporadic real visits keep the cache populated all day. Fred
// reads this 3-5x/day, so 5-30 min staleness is invisible to him.
function ttlFor(range: DateRange): number {
  switch (range.preset) {
    case 'today': return 60;       // 1 min: today data moves
    case '7d':    return 300;      // 5 min
    case '14d':   return 300;
    case '30d':   return 1800;     // 30 min
    case '90d':   return 3600;     // 1 hour
    case 'all':   return 3600;
    case 'custom': return 600;     // 10 min
    default: return 300;
  }
}

function cacheKey(queryName: string, range: DateRange, mode: TrafficMode = 'humans'): string {
  // Round the "to" side to the current day so a preset like "7d" produces
  // the same key across requests within a day. Without this rounding, toIso
  // was `now.toISOString()` and every request had a unique key (never hit).
  // Custom ranges already have stable from/to so they're keyed exactly.
  const today = new Date().toISOString().slice(0, 10);
  const modeTag = mode === 'all' ? ':all' : '';
  if (range.isCustom) {
    return `hq:${CACHE_VERSION}:${queryName}${modeTag}:custom:${range.fromIso.slice(0, 10)}:${range.toIso.slice(0, 10)}`;
  }
  return `hq:${CACHE_VERSION}:${queryName}${modeTag}:${range.preset}:${today}`;
}

async function cached<T>(
  queryName: string,
  range: DateRange,
  fetchFresh: () => Promise<T>,
  mode: TrafficMode = 'humans'
): Promise<T> {
  const redis = getRedis();
  const key = cacheKey(queryName, range, mode);
  if (redis) {
    try {
      const hit = await redis.get<T>(key);
      if (hit !== null && hit !== undefined) return hit;
    } catch (e) {
      console.warn('[hq cache] read failed', queryName, e);
    }
  }
  const fresh = await fetchFresh();
  if (redis) {
    // Fire-and-forget write so we don't block the response on the cache write.
    redis.set(key, fresh, { ex: ttlFor(range) }).catch((e) => {
      console.warn('[hq cache] write failed', queryName, e);
    });
  }
  return fresh;
}

// Datacenter cities — these are headless link scanners, not humans. Same
// list configured at the PostHog project level for insights.
const DATACENTER_CITIES = [
  'Boydton', 'Ashburn', 'Washington', 'Manassas', 'Des Moines',
  'San Jose', 'Council Bluffs', 'The Dalles', 'North Bergen',
  'Quincy', 'Cheyenne', 'Moncks Corner',
];

// Fred's own traffic — exclude so HQ doesn't show him watching himself.
const SELF_CITIES = ['Cape Town', 'Kleinmond'];

const REAL_HUMAN_WHERE = `
  AND NOT (properties.$geoip_city_name IN (${DATACENTER_CITIES.map((c) => `'${c}'`).join(', ')}))
  AND NOT (properties.$geoip_city_name IN (${SELF_CITIES.map((c) => `'${c}'`).join(', ')}))
`;

// As an inline boolean predicate (for use inside countIf etc.)
const IS_HUMAN_EXPR = `(
  NOT (properties.$geoip_city_name IN (${DATACENTER_CITIES.map((c) => `'${c}'`).join(', ')}))
  AND NOT (properties.$geoip_city_name IN (${SELF_CITIES.map((c) => `'${c}'`).join(', ')}))
)`;

// Traffic mode controls whether queries apply the real-human filter or
// show all traffic. /hq surfaces this via ?traffic=all|humans.
export type TrafficMode = 'humans' | 'all';

function humanWhereFor(mode: TrafficMode): string {
  return mode === 'all' ? '' : REAL_HUMAN_WHERE;
}

export interface HogQLResult {
  columns: string[];
  results: unknown[][];
  hogql?: string;
}

async function runQuery(hogql: string): Promise<HogQLResult> {
  // process.env is the universal Vercel runtime accessor. import.meta.env
  // works at build time but may not pick up runtime-only secrets.
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY || import.meta.env.POSTHOG_PERSONAL_API_KEY;
  if (!apiKey) {
    throw new Error('POSTHOG_PERSONAL_API_KEY env var is not set');
  }

  const res = await fetch(
    `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: { kind: 'HogQLQuery', query: hogql },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PostHog query failed: ${res.status} ${body.slice(0, 300)}`);
  }

  return (await res.json()) as HogQLResult;
}

// Turn HogQL result rows into typed objects keyed by column name.
function rowsToObjects<T = Record<string, unknown>>(r: HogQLResult): T[] {
  return r.results.map((row) => {
    const obj: Record<string, unknown> = {};
    r.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

// --------------------------------------------------------------------------
// Query: recent engaged reads
// What it is: every real human session that hit an audit page in the last
// `days` days, with at least 5 seconds of dwell.
// What it's for: the top-of-HQ "who looked at my memos recently" feed.
// --------------------------------------------------------------------------

export interface RecentRead {
  path: string;
  prospect: string;
  session_id: string | null;
  distinct_id: string;
  city: string | null;
  country: string | null;
  events: number;
  cta_clicks: number;
  dwell_seconds: number;
  last_event: string;
}

export async function getRecentReads(range: DateRange, mode: TrafficMode = 'humans'): Promise<RecentRead[]> {
  return cached('recentReads', range, async () => {
    // Lower the dwell-seconds floor to 1s when showing all traffic so scanner
    // hits actually appear (they typically dwell 0-2s).
    const minDwell = mode === 'all' ? 1 : 5;
    const r = await runQuery(`
      SELECT
        properties.$pathname AS path,
        replaceRegexpOne(properties.$pathname, '^/audit/(v3|p)(/|$)', '') AS prospect,
        properties.$session_id AS session_id,
        distinct_id,
        properties.$geoip_city_name AS city,
        properties.$geoip_country_name AS country,
        count() AS events,
        countIf(event = 'cta_clicked') AS cta_clicks,
        dateDiff('second', min(timestamp), max(timestamp)) AS dwell_seconds,
        max(timestamp) AS last_event
      FROM events
      WHERE ${hogqlRangeClause(range)}
        AND properties.$pathname ILIKE '/audit/%'
        ${humanWhereFor(mode)}
      GROUP BY path, prospect, session_id, distinct_id, city, country
      HAVING dwell_seconds >= ${minDwell}
      ORDER BY last_event DESC
      LIMIT 50
    `);
    return rowsToObjects<RecentRead>(r);
  }, mode);
}

// --------------------------------------------------------------------------
// Query: top prospects by engagement
// What it is: aggregated dwell + sessions per prospect domain over `days`.
// What it's for: ranked retargeting list.
// --------------------------------------------------------------------------

export interface ProspectSession {
  sid: string | null;
  dwell_seconds: number;
  last_event: string;
  views: number;
  clicks: number;
}

export interface TopProspect {
  prospect: string;
  total_views: number;
  unique_sessions: number;
  total_dwell_seconds: number;
  cta_clicks: number;
  last_view: string;
  sessions: ProspectSession[];
}

export async function getTopProspects(range: DateRange, mode: TrafficMode = 'humans'): Promise<TopProspect[]> {
  return cached('topProspects', range, async () => {
  // Aggregate per (prospect, session) first, then group up with groupArray to
  // also return the per-session breakdown (so the UI can expose replay links
  // per session, not just the aggregate).
  const r = await runQuery(`
    SELECT
      prospect,
      sum(session_views) AS total_views,
      count() AS unique_sessions,
      sum(session_dwell) AS total_dwell_seconds,
      sum(session_clicks) AS cta_clicks,
      max(last_event) AS last_view,
      groupArray(tuple(sid, session_dwell, last_event, session_views, session_clicks)) AS sessions_raw
    FROM (
      SELECT
        replaceRegexpOne(properties.$pathname, '^/audit/(v3|p)(/|$)', '') AS prospect,
        properties.$session_id AS sid,
        count() AS session_views,
        countIf(event = 'cta_clicked') AS session_clicks,
        dateDiff('second', min(timestamp), max(timestamp)) AS session_dwell,
        max(timestamp) AS last_event
      FROM events
      WHERE ${hogqlRangeClause(range)}
        AND properties.$pathname ILIKE '/audit/v3/%'
        ${humanWhereFor(mode)}
      GROUP BY prospect, sid
    ) AS sessions
    WHERE prospect != ''
    GROUP BY prospect
    ORDER BY total_views DESC, last_view DESC
    LIMIT 25
  `);

  // Reshape sessions_raw tuples into typed objects, sorted most-recent first.
  const raw = rowsToObjects<{
    prospect: string;
    total_views: number;
    unique_sessions: number;
    total_dwell_seconds: number;
    cta_clicks: number;
    last_view: string;
    sessions_raw: Array<[string | null, number, string, number, number]>;
  }>(r);

  return raw.map((row) => ({
    prospect: row.prospect,
    total_views: row.total_views,
    unique_sessions: row.unique_sessions,
    total_dwell_seconds: row.total_dwell_seconds,
    cta_clicks: row.cta_clicks,
    last_view: row.last_view,
    sessions: (row.sessions_raw || [])
      .map(([sid, dwell, last_event, views, clicks]) => ({
        sid,
        dwell_seconds: dwell,
        last_event,
        views,
        clicks,
      }))
      .sort((a, b) => (a.last_event < b.last_event ? 1 : -1)),
  }));
  }, mode);
}

// --------------------------------------------------------------------------
// Query: headline metrics
// What it is: 4 KPI numbers for the top-of-HQ tiles.
// --------------------------------------------------------------------------

export interface HeadlineMetrics {
  // Filtered counts (real humans only)
  memo_views: number;
  unique_visitors: number;
  engaged_reads: number;
  cta_clicks: number;
  // Raw counts (all traffic incl. scanners + self)
  memo_views_raw: number;
  unique_visitors_raw: number;
  engaged_reads_raw: number;
  cta_clicks_raw: number;
}

export async function getHeadlineMetrics(range: DateRange): Promise<HeadlineMetrics> {
  return cached('headlineMetrics', range, async () => {
    const r = await runQuery(`
      SELECT
        countIf(event = '$pageview' AND properties.$pathname ILIKE '/audit/%' AND ${IS_HUMAN_EXPR}) AS memo_views,
        uniq(if(event = '$pageview' AND properties.$pathname ILIKE '/audit/%' AND ${IS_HUMAN_EXPR}, distinct_id, NULL)) AS unique_visitors,
        uniq(if(event = 'scroll_depth' AND toInt(properties.depth) >= 50 AND properties.$pathname ILIKE '/audit/%' AND ${IS_HUMAN_EXPR}, properties.$session_id, NULL)) AS engaged_reads,
        countIf(event = 'cta_clicked' AND ${IS_HUMAN_EXPR}) AS cta_clicks,
        countIf(event = '$pageview' AND properties.$pathname ILIKE '/audit/%') AS memo_views_raw,
        uniq(if(event = '$pageview' AND properties.$pathname ILIKE '/audit/%', distinct_id, NULL)) AS unique_visitors_raw,
        uniq(if(event = 'scroll_depth' AND toInt(properties.depth) >= 50 AND properties.$pathname ILIKE '/audit/%', properties.$session_id, NULL)) AS engaged_reads_raw,
        countIf(event = 'cta_clicked') AS cta_clicks_raw
      FROM events
      WHERE ${hogqlRangeClause(range)}
    `);
    const o = rowsToObjects<HeadlineMetrics>(r);
    return o[0] ?? {
      memo_views: 0, unique_visitors: 0, engaged_reads: 0, cta_clicks: 0,
      memo_views_raw: 0, unique_visitors_raw: 0, engaged_reads_raw: 0, cta_clicks_raw: 0,
    };
  });
}

// --------------------------------------------------------------------------
// Query: CTA click feed
// --------------------------------------------------------------------------

export interface CtaClick {
  cta: string;
  prospect: string;
  city: string | null;
  country: string | null;
  href: string;
  when: string;
}

export async function getCtaClicks(range: DateRange, mode: TrafficMode = 'humans'): Promise<CtaClick[]> {
  return cached('ctaClicks', range, async () => {
  const r = await runQuery(`
    SELECT
      properties.cta AS cta,
      replaceRegexpOne(properties.path, '^/audit/(v3|p)/', '') AS prospect,
      properties.$geoip_city_name AS city,
      properties.$geoip_country_name AS country,
      properties.href AS href,
      timestamp AS when
    FROM events
    WHERE event = 'cta_clicked'
      AND ${hogqlRangeClause(range)}
      ${humanWhereFor(mode)}
    ORDER BY timestamp DESC
    LIMIT 25
  `);
  return rowsToObjects<CtaClick>(r);
  }, mode);
}

// --------------------------------------------------------------------------
// Query: top blog posts
// What it is: which blog posts get read by real humans, ranked by engagement.
// What it's for: see which content lands with the audience.
// --------------------------------------------------------------------------

export interface TopBlogPost {
  slug: string;
  path: string;
  total_views: number;
  unique_visitors: number;
  engaged_reads: number;
  cta_clicks: number;
  total_dwell_seconds: number;
  last_view: string;
}

export async function getTopBlogPosts(range: DateRange, mode: TrafficMode = 'humans'): Promise<TopBlogPost[]> {
  return cached('topBlogPosts', range, async () => {
  const r = await runQuery(`
    SELECT
      slug,
      path,
      sum(session_views) AS total_views,
      count() AS unique_visitors,
      countIf(session_max_scroll >= 50) AS engaged_reads,
      sum(session_clicks) AS cta_clicks,
      sum(session_dwell) AS total_dwell_seconds,
      max(last_event) AS last_view
    FROM (
      SELECT
        replaceRegexpOne(properties.$pathname, '^/blog/', '') AS slug,
        properties.$pathname AS path,
        properties.$session_id AS sid,
        countIf(event = '$pageview') AS session_views,
        countIf(event = 'cta_clicked') AS session_clicks,
        max(if(event = 'scroll_depth', toInt(properties.depth), 0)) AS session_max_scroll,
        dateDiff('second', min(timestamp), max(timestamp)) AS session_dwell,
        max(timestamp) AS last_event
      FROM events
      WHERE ${hogqlRangeClause(range)}
        AND properties.$pathname ILIKE '/blog/%'
        AND properties.$pathname NOT IN ('/blog/', '/blog')
        ${humanWhereFor(mode)}
      GROUP BY slug, path, sid
    ) AS sessions
    WHERE slug != ''
    GROUP BY slug, path
    ORDER BY total_views DESC, last_view DESC
    LIMIT 25
  `);
  return rowsToObjects<TopBlogPost>(r);
  }, mode);
}

// --------------------------------------------------------------------------
// Query: visitors by country
// What it is: country-level breakdown of all $pageview traffic.
// Note: this query DOES NOT exclude datacenter cities — we want operators to
// see the raw geographic distribution. Bot cities are flagged client-side.
// --------------------------------------------------------------------------

export interface CountryBreakdown {
  country: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

export async function getVisitorsByCountry(range: DateRange): Promise<CountryBreakdown[]> {
  return cached('countries', range, async () => {
    const r = await runQuery(`
      SELECT
        properties.$geoip_country_name AS country,
        uniq(distinct_id) AS visitors,
        countIf(event = '$pageview') AS pageviews,
        uniq(properties.$session_id) AS sessions
      FROM events
      WHERE ${hogqlRangeClause(range)}
        AND properties.$geoip_country_name IS NOT NULL
      GROUP BY country
      ORDER BY visitors DESC
      LIMIT 30
    `);
    return rowsToObjects<CountryBreakdown>(r);
  });
}

// --------------------------------------------------------------------------
// Query: visitors by city (with region + country)
// What it is: city-level breakdown of all $pageview traffic, NOT filtered.
// --------------------------------------------------------------------------

export interface CityBreakdown {
  city: string;
  region: string | null;
  country: string;
  visitors: number;
  pageviews: number;
  is_datacenter: boolean;
  is_self: boolean;
}

const DATACENTER_CITY_SET = new Set(DATACENTER_CITIES);
const SELF_CITY_SET = new Set(SELF_CITIES);

export async function getVisitorsByCity(range: DateRange): Promise<CityBreakdown[]> {
  return cached('cities', range, async () => {
  const r = await runQuery(`
    SELECT
      properties.$geoip_city_name AS city,
      properties.$geoip_subdivision_1_name AS region,
      properties.$geoip_country_name AS country,
      uniq(distinct_id) AS visitors,
      countIf(event = '$pageview') AS pageviews
    FROM events
    WHERE ${hogqlRangeClause(range)}
      AND properties.$geoip_city_name IS NOT NULL
    GROUP BY city, region, country
    ORDER BY visitors DESC
    LIMIT 50
  `);
  const rows = rowsToObjects<Omit<CityBreakdown, 'is_datacenter' | 'is_self'>>(r);
  return rows.map((row) => ({
    ...row,
    is_datacenter: DATACENTER_CITY_SET.has(row.city),
    is_self: SELF_CITY_SET.has(row.city),
  }));
  });
}

// --------------------------------------------------------------------------
// Query: device / browser / OS breakdown (real humans only)
// --------------------------------------------------------------------------

export interface DeviceRow {
  device_type: string | null;
  browser: string | null;
  os: string | null;
  visitors: number;
  pageviews: number;
}

export async function getVisitorTech(range: DateRange, mode: TrafficMode = 'humans'): Promise<DeviceRow[]> {
  return cached('devices', range, async () => {
    const r = await runQuery(`
      SELECT
        properties.$device_type AS device_type,
        properties.$browser AS browser,
        properties.$os AS os,
        uniq(distinct_id) AS visitors,
        countIf(event = '$pageview') AS pageviews
      FROM events
      WHERE ${hogqlRangeClause(range)}
        AND properties.$browser IS NOT NULL
        ${humanWhereFor(mode)}
      GROUP BY device_type, browser, os
      ORDER BY visitors DESC
      LIMIT 20
    `);
    return rowsToObjects<DeviceRow>(r);
  }, mode);
}

// --------------------------------------------------------------------------
// Query: traffic sources (initial referring domain, real humans only)
// --------------------------------------------------------------------------

export interface TrafficSource {
  source: string;
  visitors: number;
  pageviews: number;
}

export async function getTrafficSources(range: DateRange, mode: TrafficMode = 'humans'): Promise<TrafficSource[]> {
  return cached('sources', range, async () => {
    const r = await runQuery(`
      SELECT
        coalesce(properties.$initial_referring_domain, '$direct') AS source,
        uniq(distinct_id) AS visitors,
        countIf(event = '$pageview') AS pageviews
      FROM events
      WHERE ${hogqlRangeClause(range)}
        ${humanWhereFor(mode)}
      GROUP BY source
      ORDER BY visitors DESC
      LIMIT 20
    `);
    return rowsToObjects<TrafficSource>(r);
  }, mode);
}

// --------------------------------------------------------------------------
// Query: daily activity timeline (for a sparkline)
// Returns one row per day including today, padded with zeros for missing days.
// --------------------------------------------------------------------------

export interface ActivityDay {
  day: string;
  pageviews: number;
  visitors: number;
}

export async function getActivityTimeline(range: DateRange, mode: TrafficMode = 'humans'): Promise<ActivityDay[]> {
  return cached('activity', range, async () => {
  const r = await runQuery(`
    SELECT
      toDate(timestamp) AS day,
      countIf(event = '$pageview') AS pageviews,
      uniq(distinct_id) AS visitors
    FROM events
    WHERE ${hogqlRangeClause(range)}
      ${humanWhereFor(mode)}
    GROUP BY day
    ORDER BY day
  `);
  const rows = rowsToObjects<{ day: string; pageviews: number; visitors: number }>(r);
  // Pad days with zero so the sparkline has a stable x-axis.
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out: ActivityDay[] = [];
  const fromDate = new Date(range.fromIso);
  const span = rangeDaysSpan(range);
  // Cap to prevent silly sparkline density on "All time".
  const padDays = Math.min(span, 90);
  for (let i = 0; i < padDays; i++) {
    const d = new Date(fromDate);
    d.setUTCDate(fromDate.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const found = byDay.get(key);
    out.push(found ?? { day: key, pageviews: 0, visitors: 0 });
  }
  return out;
  }, mode);
}

// --------------------------------------------------------------------------
// Session recording deep link — generates the PostHog URL to watch a session.
// --------------------------------------------------------------------------

export function sessionReplayUrl(sessionId: string | null): string | null {
  if (!sessionId) return null;
  return `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/replay/${sessionId}`;
}

export function personDetailUrl(distinctId: string): string {
  return `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/person/${encodeURIComponent(distinctId)}`;
}

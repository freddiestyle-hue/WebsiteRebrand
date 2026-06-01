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
// v3: added `surface` column to RecentRead/TopProspect for intake-review integration.
// v4: added engagement signals (verdict_expansions, scroll_100s, copies, prints,
//     focus_seconds_total, return_visitor) and computed heat_score on TopProspect.
// v5: heat_score gates return_visitor bonus on real engagement, dwell-only no
//     longer crosses queue threshold. Stops scanner-fingerprint repeats and
//     sub-second drive-bys from polluting Action Queue.
// v6: behavioural human filter (session must contain a click/scroll/CTA/etc).
//     Replaces the city-based datacenter filter, which was leaking Amsterdam/
//     Dublin/Bristol/Frankfurt scanners and over-trusting Washington/San Jose.
// v7: split filter for headline metrics vs prospects-grade signals. Memo
//     Views / Unique Visitors / CTA Clicks use light filter (drop Fred
//     only). Engaged Reads = sessions with scroll_depth>=50 (scroll is the
//     signal). Top Prospects / Action Queue keep strict behavioural filter.
//     Behavioural-only headline metrics under-counted brief readers who
//     opened the memo but didn't scroll, plus dropped blog traffic entirely.
// v8: slug extraction strips trailing punctuation (signaturit-com. ->
//     signaturit-com) so the Airtable join hits. Recent Reads filters out
//     bare-page sessions where the slug extraction returns ''.
// v9: added related_clicks to TopProspect — counts memo_related and
//     memo_to_mri CTA hits (the new sticky exit ramps). Weighted +20 in
//     heat_score so prospects who explore further surface higher.
const CACHE_VERSION = 'v9';

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

// Behavioural human filter.
//
// Previous version filtered by datacenter city alone. That over-trusted
// scanners that don't live in datacenter cities (Microsoft Defender,
// Mimecast and other email-security crawlers fan out across Amsterdam,
// Dublin, Bristol, Frankfurt) and the queue ended up full of zero-click
// zero-scroll sessions. New filter: a session counts as human only if it
// fired at least one $autocapture click, scroll_depth, CTA, verdict expand,
// copy, print, or tab_focus_time event. Real readers do at least one of
// those. Scanners don't trigger the JS handlers meaningfully.
//
// We still exclude Fred's own home cities so he doesn't watch himself.

// Fred's own traffic - exclude so HQ doesn't show him watching himself.
const SELF_CITIES = ['Cape Town', 'Kleinmond'];

// Datacenter cities — kept for LABELLING the visitors-by-city breakdown,
// not for filtering. The behavioural filter does the real work now.
const DATACENTER_CITIES = [
  'Boydton', 'Ashburn', 'Washington', 'Manassas', 'Des Moines',
  'San Jose', 'Council Bluffs', 'The Dalles', 'North Bergen',
  'Quincy', 'Cheyenne', 'Moncks Corner',
];

const SELF_CITY_EXCLUSION = `
  NOT (properties.$geoip_city_name IN (${SELF_CITIES.map((c) => `'${c}'`).join(', ')}))
`;

// Events that prove a session was driven by a human. A scanner that just
// loads the page and fires $pageview/$pageleave won't appear here.
const HUMAN_SIGNAL_EVENTS = `'$autocapture','scroll_depth','cta_clicked','audit_v3_verdict_expanded','content_copied','content_printed','tab_focus_time'`;

/**
 * Build a "this session interacted" subquery given a time-where clause.
 * timeWhere should be a SQL fragment like "timestamp >= ..." (no leading
 * AND) so the caller controls the exact bounds.
 *
 * Matches signal events on ANY path, not just audit pages. A blog visitor
 * who scrolls a /blog/* post is still a human. This subquery is used by
 * the STRICT filter (Top Prospects, Action Queue) - top-of-funnel
 * counters use lightHumanWhere() instead.
 */
function humanSessionsSubquery(timeWhere: string): string {
  return `(
    SELECT DISTINCT properties.$session_id
    FROM events
    WHERE ${timeWhere}
      AND event IN (${HUMAN_SIGNAL_EVENTS})
  )`;
}

/**
 * Light filter: just drop Fred's own home cities. Used for top-of-funnel
 * counters (memo views, unique visitors, CTA clicks) where a brief reader
 * who didn't scroll still counts as a real view. This metric is the
 * volume number, not the quality number.
 */
function lightHumanWhere(): string {
  return `AND ${SELF_CITY_EXCLUSION}`;
}
function lightHumanExpr(): string {
  return `(${SELF_CITY_EXCLUSION})`;
}

/** Inline boolean predicate (for use inside countIf etc.). */
function humanExpr(range: DateRange): string {
  return humanExprWithTime(hogqlRangeClause(range));
}
function humanExprWithTime(timeWhere: string): string {
  return `(
    properties.$session_id IN ${humanSessionsSubquery(timeWhere)}
    AND ${SELF_CITY_EXCLUSION}
  )`;
}

/** As a WHERE clause fragment (leading AND). */
function humanWhere(range: DateRange): string {
  return `
    AND properties.$session_id IN ${humanSessionsSubquery(hogqlRangeClause(range))}
    AND ${SELF_CITY_EXCLUSION}
  `;
}

// Traffic mode controls whether queries apply the real-human filter or
// show all traffic. /hq surfaces this via ?traffic=all|humans.
export type TrafficMode = 'humans' | 'all';

function humanWhereFor(mode: TrafficMode, range: DateRange): string {
  return mode === 'all' ? '' : humanWhere(range);
}

/**
 * Light-mode equivalent. Drops Fred's home cities only. Used by every query
 * except Top Prospects (which needs the strict behavioural filter to find
 * actionable, not just-viewing, prospects).
 */
function lightHumanWhereFor(mode: TrafficMode): string {
  return mode === 'all' ? '' : `AND ${SELF_CITY_EXCLUSION}`;
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
// Prospect surfaces — both feed into /hq:
//   audit          → rivett.tech/audit/v3/{slug} and /audit/p/{slug}
//   intake-review  → intake-reviews.vercel.app/intake-review/{slug}
// Same PostHog project (373899), different domains. The PostHog snippet in
// each surface registers `surface: '<name>'` as a super-property, but we
// fall back to path-based detection so historic data without the property
// still classifies correctly.
// --------------------------------------------------------------------------

// Path filter: any prospect-facing surface, either audit or intake review.
const PROSPECT_PATH_FILTER = `(
  properties.$pathname ILIKE '/audit/%'
  OR properties.$pathname ILIKE '/intake-review/%'
)`;

// Top-prospects path filter: same, but only the v3 audit format (since the
// older v1/v2 audits are deprecated and shouldn't pollute the leaderboard).
const PROSPECT_PATH_FILTER_TOP = `(
  properties.$pathname ILIKE '/audit/v3/%'
  OR properties.$pathname ILIKE '/intake-review/%'
)`;

// Slug extraction: strip the leading surface path so the remainder is the
// prospect identifier (a domain-like slug, e.g. "mindfulhealthsolutions-com").
// Also strip any trailing dots/whitespace/slashes because email clients
// sometimes append punctuation to URLs ("/audit/v3/signaturit-com." in
// the wild — break the Airtable slug join unless we normalise here).
const PROSPECT_SLUG_EXPR =
  `replaceRegexpOne(replaceRegexpOne(properties.$pathname, '^/(audit/(v3|p)|intake-review)(/|$)', ''), '[\\\\s./]+$', '')`;

// Surface classification — inspect the path. Cheaper than reading the
// PostHog super-property and works on historic events too.
const PROSPECT_SURFACE_EXPR = `
  CASE
    WHEN properties.$pathname ILIKE '/intake-review/%' THEN 'intake-review'
    ELSE 'audit'
  END
`;

// --------------------------------------------------------------------------
// Query: recent engaged reads
// What it is: every real human session that hit an audit page in the last
// `days` days, with at least 5 seconds of dwell.
// What it's for: the top-of-HQ "who looked at my memos recently" feed.
// --------------------------------------------------------------------------

export interface RecentRead {
  path: string;
  prospect: string;
  surface: 'audit' | 'intake-review';
  session_id: string | null;
  distinct_id: string;
  city: string | null;
  country: string | null;
  events: number;
  cta_clicks: number;
  dwell_seconds: number;
  last_event: string;
  // True if the session fired any real human-engagement event on THIS path:
  // scroll_depth, cta_clicked, content_copied, content_printed, or
  // audit_v3_verdict_expanded. False = pageview/web_vitals/tab_focus_time
  // only (the email-scanner fingerprint). Used by RecentReadsFeed to badge
  // "raw" rows so Fred can see signal vs noise at a glance — never hides.
  is_engaged: boolean;
}

export async function getRecentReads(range: DateRange, mode: TrafficMode = 'humans'): Promise<RecentRead[]> {
  return cached('recentReads', range, async () => {
    // Lower the dwell-seconds floor to 1s when showing all traffic so scanner
    // hits actually appear (they typically dwell 0-2s).
    const minDwell = mode === 'all' ? 1 : 5;
    const r = await runQuery(`
      SELECT
        properties.$pathname AS path,
        ${PROSPECT_SLUG_EXPR} AS prospect,
        ${PROSPECT_SURFACE_EXPR} AS surface,
        properties.$session_id AS session_id,
        distinct_id,
        properties.$geoip_city_name AS city,
        properties.$geoip_country_name AS country,
        count() AS events,
        countIf(event = 'cta_clicked') AS cta_clicks,
        dateDiff('second', min(timestamp), max(timestamp)) AS dwell_seconds,
        max(timestamp) AS last_event,
        -- v3.5 raw-vs-engaged flag. Scanners (SafeLinks/Mimecast/etc.) fire
        -- pageview + web_vitals + tab_focus_time + pageleave but never any
        -- of these. Real humans fire at least one. Used as a UI label, not
        -- as a filter, so a real prospect who briefly lands and bounces is
        -- not hidden.
        countIf(event IN (
          'scroll_depth','cta_clicked','content_copied',
          'content_printed','audit_v3_verdict_expanded'
        )) > 0 AS is_engaged
      FROM events
      WHERE ${hogqlRangeClause(range)}
        AND ${PROSPECT_PATH_FILTER}
        ${lightHumanWhereFor(mode)}
      GROUP BY path, prospect, surface, session_id, distinct_id, city, country
      HAVING dwell_seconds >= ${minDwell} AND prospect != ''
      ORDER BY last_event DESC
      LIMIT 50
    `);
    const raw = rowsToObjects<Omit<RecentRead, 'is_engaged'> & { is_engaged: boolean | number }>(r);
    // HogQL returns the boolean as 0/1 in some serializations — coerce.
    return raw.map((row) => ({
      ...row,
      is_engaged: Boolean(row.is_engaged),
    }));
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
  surface: 'audit' | 'intake-review';
  total_views: number;
  unique_sessions: number;
  // Distinct people (resolved person_id) across all sessions in the range.
  // The strongest cold-outreach signal: N>=2 = "they forwarded it internally".
  distinct_visitors: number;
  total_dwell_seconds: number;
  cta_clicks: number;
  // v4 engagement signals
  verdict_expansions: number;     // audit_v3_verdict_expanded events
  scroll_100s: number;            // scroll_depth where depth=100 (full reads)
  copies: number;                 // content_copied events (selection >= 20 chars)
  prints: number;                 // content_printed events (saving as PDF)
  focus_seconds_total: number;    // sum of tab_focus_time.focus_seconds across sessions
  return_visitor: boolean;        // unique_sessions > 1 (came back at least once)
  // v9 stickiness signal
  related_clicks: number;         // cta_clicked with cta=memo_related (blog read-next) or memo_to_mri
  // v3.5 per-cell drill-down signal (which dimensions did they expand on the audit)
  // Each entry is the dimension icon key (e.g. 'search', 'spark', 'mail'),
  // distinct, ordered by first-click time within the time window.
  expanded_dimensions: string[];
  heat_score: number;             // weighted composite, see heatScoreSql below
  last_view: string;
  sessions: ProspectSession[];
}

// Heat score weights - tunable. Tuned for "is this prospect worth a follow-up
// today" not "did they technically visit". The return-visitor bonus is gated
// on real engagement: coming back twice means nothing if both sessions were
// 2-second drive-bys (which is exactly what scanner traffic looks like after
// the datacenter-city filter misses one). Bumping queue threshold to >=25 so
// pure dwell never crosses on its own.
//
// Weights (per occurrence unless noted):
//   prints:                      +40
//   copies:                      +30
//   distinct_visitors >= 2:      +35  (internal-share signal — exec forwarded)
//   distinct_visitors >= 3:      +25  (additive — team is reviewing)
//   distinct_visitors >= 4:      +25  (additive — many stakeholders, buy signal)
//   cta_clicks:                  +25
//   related_clicks:              +20  (memo_related / memo_to_mri — sticky signal)
//   scroll_100s:                 +15
//   verdict_expansions:          +10
//   return_visitor (bool):       +30, ONLY if there is also real engagement
//   focus_seconds_total / 10:    +1, capped at +20
//   total_dwell_seconds / 30:    +1, capped at +10
const HEAT_SCORE_SQL = `(
  (prints * 40) +
  (copies * 30) +
  (if(distinct_visitors >= 2, 35, 0)) +
  (if(distinct_visitors >= 3, 25, 0)) +
  (if(distinct_visitors >= 4, 25, 0)) +
  (cta_clicks * 25) +
  (related_clicks * 20) +
  (scroll_100s * 15) +
  (verdict_expansions * 10) +
  (if(unique_sessions > 1 AND (total_dwell_seconds >= 30 OR scroll_100s > 0 OR verdict_expansions > 0 OR cta_clicks > 0 OR copies > 0 OR prints > 0 OR related_clicks > 0), 30, 0)) +
  least(20, intDiv(focus_seconds_total, 10)) +
  least(10, intDiv(total_dwell_seconds, 30))
)`;

export async function getTopProspects(range: DateRange, mode: TrafficMode = 'humans'): Promise<TopProspect[]> {
  return cached('topProspects', range, async () => {
  // Aggregate per (prospect, session) first, then group up with groupArray to
  // also return the per-session breakdown (so the UI can expose replay links
  // per session, not just the aggregate).
  const r = await runQuery(`
    SELECT
      prospect,
      surface,
      sum(session_views) AS total_views,
      count() AS unique_sessions,
      uniqIf(session_person_id, session_person_id != '') AS distinct_visitors,
      sum(session_dwell) AS total_dwell_seconds,
      sum(session_clicks) AS cta_clicks,
      sum(session_verdicts) AS verdict_expansions,
      sum(session_scroll_100) AS scroll_100s,
      sum(session_copies) AS copies,
      sum(session_prints) AS prints,
      sum(session_focus) AS focus_seconds_total,
      sum(session_related) AS related_clicks,
      arrayDistinct(arrayFlatten(groupArray(session_expanded_dims))) AS expanded_dimensions,
      ${HEAT_SCORE_SQL} AS heat_score,
      max(last_event) AS last_view,
      groupArray(tuple(sid, session_dwell, last_event, session_views, session_clicks)) AS sessions_raw
    FROM (
      SELECT
        ${PROSPECT_SLUG_EXPR} AS prospect,
        ${PROSPECT_SURFACE_EXPR} AS surface,
        properties.$session_id AS sid,
        toString(any(person_id)) AS session_person_id,
        count() AS session_views,
        countIf(event = 'cta_clicked') AS session_clicks,
        countIf(event = 'audit_v3_verdict_expanded') AS session_verdicts,
        countIf(event = 'scroll_depth' AND toInt(properties.depth) = 100) AS session_scroll_100,
        countIf(event = 'content_copied') AS session_copies,
        countIf(event = 'content_printed') AS session_prints,
        sumIf(toInt(properties.focus_seconds), event = 'tab_focus_time') AS session_focus,
        countIf(event = 'cta_clicked' AND (properties.cta = 'memo_related' OR properties.cta = 'memo_to_mri')) AS session_related,
        -- v3.5 per-cell drill-down: collect distinct dimension icon keys this
        -- session expanded. cta is 'cell_expand_search', 'cell_expand_spark',
        -- etc. — strip the prefix client-side. Order preserved by first click
        -- within the session, deduped at the outer layer.
        arrayDistinct(groupArrayIf(replaceOne(properties.cta, 'cell_expand_', ''), event = 'cta_clicked' AND properties.cta LIKE 'cell_expand_%')) AS session_expanded_dims,
        dateDiff('second', min(timestamp), max(timestamp)) AS session_dwell,
        max(timestamp) AS last_event
      FROM events
      WHERE ${hogqlRangeClause(range)}
        AND ${PROSPECT_PATH_FILTER_TOP}
        ${humanWhereFor(mode)}
      GROUP BY prospect, surface, sid
    ) AS sessions
    WHERE prospect != ''
    GROUP BY prospect, surface
    -- Defence in depth: even with the strict humanWhereFor session filter
    -- above, require that the aggregate across all of a prospect's sessions
    -- shows at least one human signal before they qualify for the Action
    -- Queue. Pure-dwell prospects (Microsoft SafeLinks / Mimecast scanners
    -- sitting on the page for 30s with no scroll, click, copy, or print)
    -- got labelled "engaged" because the badge fell back to dwell-only.
    -- This HAVING clause is the query-side guarantee.
    HAVING ${
      mode === 'humans'
        ? '(cta_clicks + verdict_expansions + scroll_100s + copies + prints + related_clicks) > 0 OR focus_seconds_total >= 10'
        : '1=1'
    }
    ORDER BY heat_score DESC, last_view DESC
    LIMIT 25
  `);

  // Reshape sessions_raw tuples into typed objects, sorted most-recent first.
  const raw = rowsToObjects<{
    prospect: string;
    surface: 'audit' | 'intake-review';
    total_views: number;
    unique_sessions: number;
    distinct_visitors: number;
    total_dwell_seconds: number;
    cta_clicks: number;
    verdict_expansions: number;
    scroll_100s: number;
    copies: number;
    prints: number;
    focus_seconds_total: number;
    related_clicks: number;
    expanded_dimensions: string[];
    heat_score: number;
    last_view: string;
    sessions_raw: Array<[string | null, number, string, number, number]>;
  }>(r);

  return raw.map((row) => ({
    prospect: row.prospect,
    surface: row.surface,
    total_views: row.total_views,
    unique_sessions: row.unique_sessions,
    distinct_visitors: row.distinct_visitors ?? row.unique_sessions,
    total_dwell_seconds: row.total_dwell_seconds,
    cta_clicks: row.cta_clicks,
    verdict_expansions: row.verdict_expansions ?? 0,
    scroll_100s: row.scroll_100s ?? 0,
    copies: row.copies ?? 0,
    prints: row.prints ?? 0,
    focus_seconds_total: row.focus_seconds_total ?? 0,
    related_clicks: row.related_clicks ?? 0,
    expanded_dimensions: (row.expanded_dimensions ?? []).filter((d) => d && d !== ''),
    return_visitor: row.unique_sessions > 1,
    heat_score: row.heat_score ?? 0,
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
  // Filtered counts (real humans only) — current period
  memo_views: number;
  unique_visitors: number;
  engaged_reads: number;
  cta_clicks: number;
  // Raw counts (all traffic incl. scanners + self) — current period
  memo_views_raw: number;
  unique_visitors_raw: number;
  engaged_reads_raw: number;
  cta_clicks_raw: number;
  // Previous-period equivalents (humans only) — for % change comparison
  memo_views_prev: number;
  unique_visitors_prev: number;
  engaged_reads_prev: number;
  cta_clicks_prev: number;
  // Daily sparkline arrays (humans only) — for the inline mini-chart
  spark_memo_views: number[];
  spark_unique_visitors: number[];
  spark_engaged_reads: number[];
  spark_cta_clicks: number[];
}

export async function getHeadlineMetrics(range: DateRange): Promise<HeadlineMetrics> {
  return cached('headlineMetrics', range, async () => {
    // Compute the equivalent previous period: same length, ending where the
    // current period begins. e.g. for last 14 days, prev = 14 days before that.
    const fromMs = new Date(range.fromIso).getTime();
    const toMs = new Date(range.toIso).getTime();
    const spanMs = Math.max(toMs - fromMs, 24 * 60 * 60 * 1000);
    const prevToIso = new Date(fromMs - 1).toISOString();
    const prevFromIso = new Date(fromMs - spanMs).toISOString();

    // Run three queries in parallel: current totals, previous-period totals,
    // daily breakdown for sparklines.
    const [currentRes, prevRes, dailyRes] = await Promise.all([
      runQuery(`
        SELECT
          countIf(event = '$pageview' AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}) AS memo_views,
          uniq(if(event = '$pageview' AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}, distinct_id, NULL)) AS unique_visitors,
          uniq(if(event = 'scroll_depth' AND toInt(properties.depth) >= 50 AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}, properties.$session_id, NULL)) AS engaged_reads,
          countIf(event = 'cta_clicked' AND ${lightHumanExpr()}) AS cta_clicks,
          countIf(event = '$pageview' AND ${PROSPECT_PATH_FILTER}) AS memo_views_raw,
          uniq(if(event = '$pageview' AND ${PROSPECT_PATH_FILTER}, distinct_id, NULL)) AS unique_visitors_raw,
          uniq(if(event = 'scroll_depth' AND toInt(properties.depth) >= 50 AND ${PROSPECT_PATH_FILTER}, properties.$session_id, NULL)) AS engaged_reads_raw,
          countIf(event = 'cta_clicked') AS cta_clicks_raw
        FROM events
        WHERE ${hogqlRangeClause(range)}
      `),
      runQuery((() => {
        const prevTimeWhere = `timestamp >= toDateTime('${prevFromIso}') AND timestamp <= toDateTime('${prevToIso}')`;
        return `
        SELECT
          countIf(event = '$pageview' AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}) AS memo_views,
          uniq(if(event = '$pageview' AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}, distinct_id, NULL)) AS unique_visitors,
          uniq(if(event = 'scroll_depth' AND toInt(properties.depth) >= 50 AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}, properties.$session_id, NULL)) AS engaged_reads,
          countIf(event = 'cta_clicked' AND ${lightHumanExpr()}) AS cta_clicks
        FROM events
        WHERE ${prevTimeWhere}
      `;
      })()),
      runQuery(`
        SELECT
          toDate(timestamp) AS day,
          countIf(event = '$pageview' AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}) AS memo_views,
          uniq(if(event = '$pageview' AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}, distinct_id, NULL)) AS unique_visitors,
          uniq(if(event = 'scroll_depth' AND toInt(properties.depth) >= 50 AND ${PROSPECT_PATH_FILTER} AND ${lightHumanExpr()}, properties.$session_id, NULL)) AS engaged_reads,
          countIf(event = 'cta_clicked' AND ${lightHumanExpr()}) AS cta_clicks
        FROM events
        WHERE ${hogqlRangeClause(range)}
        GROUP BY day
        ORDER BY day
      `),
    ]);

    const current = rowsToObjects<{
      memo_views: number;
      unique_visitors: number;
      engaged_reads: number;
      cta_clicks: number;
      memo_views_raw: number;
      unique_visitors_raw: number;
      engaged_reads_raw: number;
      cta_clicks_raw: number;
    }>(currentRes)[0] ?? {
      memo_views: 0, unique_visitors: 0, engaged_reads: 0, cta_clicks: 0,
      memo_views_raw: 0, unique_visitors_raw: 0, engaged_reads_raw: 0, cta_clicks_raw: 0,
    };

    const prev = rowsToObjects<{
      memo_views: number;
      unique_visitors: number;
      engaged_reads: number;
      cta_clicks: number;
    }>(prevRes)[0] ?? { memo_views: 0, unique_visitors: 0, engaged_reads: 0, cta_clicks: 0 };

    // Build per-day sparkline arrays, padded with 0 for missing days so the
    // sparkline x-axis spans the full requested range.
    const daily = rowsToObjects<{
      day: string;
      memo_views: number;
      unique_visitors: number;
      engaged_reads: number;
      cta_clicks: number;
    }>(dailyRes);
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const span = Math.max(1, Math.min(rangeDaysSpan(range), 90));
    const sparkV: number[] = [];
    const sparkU: number[] = [];
    const sparkE: number[] = [];
    const sparkC: number[] = [];
    const fromDate = new Date(range.fromIso);
    for (let i = 0; i < span; i++) {
      const d = new Date(fromDate);
      d.setUTCDate(fromDate.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const hit = byDay.get(key);
      sparkV.push(hit?.memo_views ?? 0);
      sparkU.push(hit?.unique_visitors ?? 0);
      sparkE.push(hit?.engaged_reads ?? 0);
      sparkC.push(hit?.cta_clicks ?? 0);
    }

    return {
      ...current,
      memo_views_prev: prev.memo_views,
      unique_visitors_prev: prev.unique_visitors,
      engaged_reads_prev: prev.engaged_reads,
      cta_clicks_prev: prev.cta_clicks,
      spark_memo_views: sparkV,
      spark_unique_visitors: sparkU,
      spark_engaged_reads: sparkE,
      spark_cta_clicks: sparkC,
    };
  });
}

// --------------------------------------------------------------------------
// Query: active now — distinct sessions that fired any event in the last 30
// minutes. For the real-time "viewing now" widget at the top of /hq.
// Not cached: this needs live freshness.
// --------------------------------------------------------------------------

export interface ActiveNow {
  active_sessions: number;
  active_visitors: number;
  recent_paths: { path: string; count: number }[];
}

export async function getActiveNow(): Promise<ActiveNow> {
  // Active-now uses its own 30-minute window, not the page's DateRange. Build
  // the human-session subquery against the same 30-minute bound.
  const activeTimeWhere = `timestamp >= now() - INTERVAL 30 MINUTE`;
  const activeHumanWhere = `
    AND properties.$session_id IN (
      SELECT DISTINCT properties.$session_id FROM events
      WHERE ${activeTimeWhere}
        AND (properties.$pathname LIKE '/audit/v3/%' OR properties.$pathname LIKE '/audit/p/%')
        AND event IN (${HUMAN_SIGNAL_EVENTS})
    )
    AND ${SELF_CITY_EXCLUSION}
  `;
  const r = await runQuery(`
    SELECT
      uniq(properties.$session_id) AS active_sessions,
      uniq(distinct_id) AS active_visitors
    FROM events
    WHERE ${activeTimeWhere}
      ${activeHumanWhere}
  `);
  const head = rowsToObjects<{ active_sessions: number; active_visitors: number }>(r)[0] ?? {
    active_sessions: 0,
    active_visitors: 0,
  };
  const pathsRes = await runQuery(`
    SELECT
      properties.$pathname AS path,
      count() AS count
    FROM events
    WHERE event = '$pageview'
      AND ${activeTimeWhere}
      ${activeHumanWhere}
    GROUP BY path
    ORDER BY count DESC
    LIMIT 5
  `);
  return {
    ...head,
    recent_paths: rowsToObjects<{ path: string; count: number }>(pathsRes),
  };
}

// --------------------------------------------------------------------------
// Query: CTA click feed
// --------------------------------------------------------------------------

export interface CtaClick {
  cta: string;
  prospect: string;
  surface: 'audit' | 'intake-review';
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
      replaceRegexpOne(properties.path, '^/(audit/(v3|p)|intake-review)/', '') AS prospect,
      CASE
        WHEN properties.path ILIKE '/intake-review/%' THEN 'intake-review'
        ELSE 'audit'
      END AS surface,
      properties.$geoip_city_name AS city,
      properties.$geoip_country_name AS country,
      properties.href AS href,
      timestamp AS when
    FROM events
    WHERE event = 'cta_clicked'
      AND ${hogqlRangeClause(range)}
      ${lightHumanWhereFor(mode)}
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
  // Humans-only (real readers, scanners + self excluded)
  views_humans: number;
  visitors_humans: number;
  engaged_humans: number;
  cta_clicks_humans: number;
  // Raw (all traffic) — so freshly-published posts that only had a scanner
  // hit show '0 humans · 3 raw' instead of looking empty.
  views_raw: number;
  visitors_raw: number;
  engaged_raw: number;
  cta_clicks_raw: number;
  total_dwell_seconds_humans: number;
  last_view: string;
}

export async function getTopBlogPosts(range: DateRange): Promise<TopBlogPost[]> {
  // Mode-agnostic: always returns BOTH human + raw counts in one query so the
  // table can show '0 humans · 3 raw' for newly-published posts that only
  // have scanner traffic so far. The page's traffic toggle no longer affects
  // this section because the table shows both anyway.
  return cached('topBlogPosts', range, async () => {
    const r = await runQuery(`
      SELECT
        slug,
        path,
        sumIf(session_views, session_is_human) AS views_humans,
        countIf(session_is_human) AS visitors_humans,
        countIf(session_is_human AND session_max_scroll >= 50) AS engaged_humans,
        sumIf(session_clicks, session_is_human) AS cta_clicks_humans,
        sum(session_views) AS views_raw,
        count() AS visitors_raw,
        countIf(session_max_scroll >= 50) AS engaged_raw,
        sum(session_clicks) AS cta_clicks_raw,
        sumIf(session_dwell, session_is_human) AS total_dwell_seconds_humans,
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
          max(timestamp) AS last_event,
          /* session is human if any event was outside scanner+self cities */
          max(${humanExpr(range)}) AS session_is_human
        FROM events
        WHERE ${hogqlRangeClause(range)}
          AND properties.$pathname ILIKE '/blog/%'
          AND properties.$pathname NOT IN ('/blog/', '/blog')
        GROUP BY slug, path, sid
      ) AS sessions
      WHERE slug != ''
      GROUP BY slug, path
      ORDER BY views_raw DESC, last_view DESC
      LIMIT 25
    `);
    return rowsToObjects<TopBlogPost>(r);
  });
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
        ${lightHumanWhereFor(mode)}
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
        ${lightHumanWhereFor(mode)}
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
      ${lightHumanWhereFor(mode)}
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

// --------------------------------------------------------------------------
// Query: when do memos actually get opened?
// Buckets pageviews on audit pages by hour-of-day (0-23) and day-of-week
// (1-7, where 1=Monday per ClickHouse toDayOfWeek). Used by the timing
// panel to surface when to send so opens land in office hours.
// --------------------------------------------------------------------------

export interface OpenTiming {
  by_hour: { hour: number; opens: number }[];
  by_dow: { dow: number; opens: number }[];
}

export async function getOpenTimingDistribution(range: DateRange): Promise<OpenTiming> {
  return cached('openTiming', range, async () => {
    const [hourRes, dowRes] = await Promise.all([
      runQuery(`
        SELECT
          toHour(timestamp) AS hour,
          count() AS opens
        FROM events
        WHERE ${hogqlRangeClause(range)}
          AND event = '$pageview'
          AND ${PROSPECT_PATH_FILTER}
          AND ${lightHumanExpr()}
        GROUP BY hour
        ORDER BY hour
      `),
      runQuery(`
        SELECT
          toDayOfWeek(timestamp) AS dow,
          count() AS opens
        FROM events
        WHERE ${hogqlRangeClause(range)}
          AND event = '$pageview'
          AND ${PROSPECT_PATH_FILTER}
          AND ${lightHumanExpr()}
        GROUP BY dow
        ORDER BY dow
      `),
    ]);
    const by_hour = rowsToObjects<{ hour: number; opens: number }>(hourRes);
    const by_dow = rowsToObjects<{ dow: number; opens: number }>(dowRes);
    // Pad missing buckets with 0 so the chart always has full axes.
    const hourMap = new Map(by_hour.map((r) => [Number(r.hour), Number(r.opens)]));
    const dowMap = new Map(by_dow.map((r) => [Number(r.dow), Number(r.opens)]));
    return {
      by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, opens: hourMap.get(h) ?? 0 })),
      by_dow: Array.from({ length: 7 }, (_, i) => ({ dow: i + 1, opens: dowMap.get(i + 1) ?? 0 })),
    };
  });
}

// --------------------------------------------------------------------------

export function sessionReplayUrl(sessionId: string | null): string | null {
  if (!sessionId) return null;
  return `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/replay/${sessionId}`;
}

export function personDetailUrl(distinctId: string): string {
  return `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/person/${encodeURIComponent(distinctId)}`;
}

// Server-side PostHog HogQL query helper used by the /hq analytics page.
//
// Authentication uses a personal API key stored as POSTHOG_PERSONAL_API_KEY.
// This MUST stay server-only. Astro will fail the build if this file is
// imported from a `client:` directive component. Never `console.log` the key.
//
// All queries exclude datacenter cities (Microsoft SafeLinks/Mimecast/etc.)
// and Fred's own home cities so the HQ page shows real prospect engagement.

const POSTHOG_HOST = 'https://us.posthog.com';
const POSTHOG_PROJECT_ID = 373899;

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

export async function getRecentReads(days = 14): Promise<RecentRead[]> {
  const r = await runQuery(`
    SELECT
      properties.$pathname AS path,
      replaceRegexpOne(properties.$pathname, '^/audit/(v3|p)/', '') AS prospect,
      properties.$session_id AS session_id,
      distinct_id,
      properties.$geoip_city_name AS city,
      properties.$geoip_country_name AS country,
      count() AS events,
      countIf(event = 'cta_clicked') AS cta_clicks,
      dateDiff('second', min(timestamp), max(timestamp)) AS dwell_seconds,
      max(timestamp) AS last_event
    FROM events
    WHERE timestamp >= now() - INTERVAL ${days} DAY
      AND properties.$pathname ILIKE '/audit/%'
      ${REAL_HUMAN_WHERE}
    GROUP BY path, prospect, session_id, distinct_id, city, country
    HAVING dwell_seconds >= 5
    ORDER BY last_event DESC
    LIMIT 50
  `);
  return rowsToObjects<RecentRead>(r);
}

// --------------------------------------------------------------------------
// Query: top prospects by engagement
// What it is: aggregated dwell + sessions per prospect domain over `days`.
// What it's for: ranked retargeting list.
// --------------------------------------------------------------------------

export interface TopProspect {
  prospect: string;
  total_views: number;
  unique_sessions: number;
  total_dwell_seconds: number;
  cta_clicks: number;
  last_view: string;
}

export async function getTopProspects(days = 14): Promise<TopProspect[]> {
  // Aggregate per (prospect, session) first so we can sum session-level dwell.
  const r = await runQuery(`
    SELECT
      prospect,
      sum(session_views) AS total_views,
      count() AS unique_sessions,
      sum(session_dwell) AS total_dwell_seconds,
      sum(session_clicks) AS cta_clicks,
      max(last_event) AS last_view
    FROM (
      SELECT
        replaceRegexpOne(properties.$pathname, '^/audit/(v3|p)/', '') AS prospect,
        properties.$session_id AS sid,
        count() AS session_views,
        countIf(event = 'cta_clicked') AS session_clicks,
        dateDiff('second', min(timestamp), max(timestamp)) AS session_dwell,
        max(timestamp) AS last_event
      FROM events
      WHERE timestamp >= now() - INTERVAL ${days} DAY
        AND properties.$pathname ILIKE '/audit/v3/%'
        ${REAL_HUMAN_WHERE}
      GROUP BY prospect, sid
    ) AS sessions
    WHERE prospect != ''
    GROUP BY prospect
    ORDER BY total_views DESC, last_view DESC
    LIMIT 25
  `);
  return rowsToObjects<TopProspect>(r);
}

// --------------------------------------------------------------------------
// Query: headline metrics
// What it is: 4 KPI numbers for the top-of-HQ tiles.
// --------------------------------------------------------------------------

export interface HeadlineMetrics {
  memo_views_7d: number;
  unique_visitors_7d: number;
  engaged_reads_7d: number;
  cta_clicks_7d: number;
}

export async function getHeadlineMetrics(): Promise<HeadlineMetrics> {
  const r = await runQuery(`
    SELECT
      countIf(event = '$pageview' AND properties.$pathname ILIKE '/audit/%') AS memo_views_7d,
      uniq(if(event = '$pageview' AND properties.$pathname ILIKE '/audit/%', distinct_id, NULL)) AS unique_visitors_7d,
      uniq(if(event = 'scroll_depth' AND toInt(properties.depth) >= 50 AND properties.$pathname ILIKE '/audit/%', properties.$session_id, NULL)) AS engaged_reads_7d,
      countIf(event = 'cta_clicked') AS cta_clicks_7d
    FROM events
    WHERE timestamp >= now() - INTERVAL 7 DAY
      ${REAL_HUMAN_WHERE}
  `);
  const o = rowsToObjects<{
    memo_views_7d: number;
    unique_visitors_7d: number;
    engaged_reads_7d: number;
    cta_clicks_7d: number;
  }>(r);
  return o[0] ?? { memo_views_7d: 0, unique_visitors_7d: 0, engaged_reads_7d: 0, cta_clicks_7d: 0 };
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

export async function getCtaClicks(days = 14): Promise<CtaClick[]> {
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
      AND timestamp >= now() - INTERVAL ${days} DAY
      ${REAL_HUMAN_WHERE}
    ORDER BY timestamp DESC
    LIMIT 25
  `);
  return rowsToObjects<CtaClick>(r);
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

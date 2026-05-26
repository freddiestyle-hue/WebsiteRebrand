// Cron-triggered endpoint that pre-warms the /hq query cache.
//
// Vercel cron hits this every 5 minutes with Authorization: Bearer <CRON_SECRET>.
// We run all 10 PostHog queries for every preset range so the cache is always
// warm. Subsequent /hq page renders hit Redis (sub-second) instead of running
// the live PostHog queries (multi-second).
//
// Auth: a request without the correct CRON_SECRET bearer token gets 401.
// This protects the endpoint from random visitors triggering the heavy fetch.

import type { APIRoute } from 'astro';
import {
  getRecentReads,
  getTopProspects,
  getHeadlineMetrics,
  getCtaClicks,
  getTopBlogPosts,
  getVisitorsByCountry,
  getVisitorsByCity,
  getVisitorTech,
  getTrafficSources,
  getActivityTimeline,
} from '../../../utils/posthog/query';
import { parseDateRange, PRESETS } from '../../../utils/posthog/dateRange';
import { getMessagedSlugs } from '../../../utils/hq/messaged';
import { sendDigestEmail } from '../../../utils/hq/notify';

export const prerender = false;

async function warmRange(rangeKey: string) {
  const sp = new URLSearchParams();
  sp.set('range', rangeKey);
  const range = parseDateRange(sp);

  // Fire all 10 queries in parallel; results get cached as a side effect.
  await Promise.all([
    getHeadlineMetrics(range),
    getRecentReads(range),
    getTopProspects(range),
    getCtaClicks(range),
    getTopBlogPosts(range),
    getVisitorsByCountry(range),
    getVisitorsByCity(range),
    getVisitorTech(range),
    getTrafficSources(range),
    getActivityTimeline(range),
  ]);
}

// Default to the 3 hot ranges Fred actually uses. Vercel Hobby caps function
// duration at 10s, and warming all 6 presets sequentially blows past that.
// Other ranges warm on first real visit (one slow load, then cached).
const DEFAULT_WARM = ['today', '7d', '14d'];

export const GET: APIRoute = async ({ request, url }) => {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (expected && bearer !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Allow custom range list via ?ranges=today,7d (comma-separated). Default is
  // the hot trio. `?ranges=all-presets` warms every preset (manual operator
  // trigger only — won't fit in the 10s cron budget).
  const param = url.searchParams.get('ranges');
  let toWarm: string[];
  if (param === 'all-presets') {
    toWarm = PRESETS.map((p) => p.value);
  } else if (param) {
    toWarm = param.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    toWarm = DEFAULT_WARM;
  }

  const started = Date.now();
  // Warm in parallel — each range internally fires 10 PostHog queries in
  // parallel. Three ranges × 10 = 30 concurrent queries, comfortably inside
  // the function timeout.
  const settled = await Promise.allSettled(
    toWarm.map(async (preset) => {
      const t0 = Date.now();
      await warmRange(preset);
      return { preset, ms: Date.now() - t0 };
    })
  );

  const results: Record<string, { ok: boolean; ms: number; error?: string }> = {};
  settled.forEach((r, i) => {
    const preset = toWarm[i];
    if (r.status === 'fulfilled') {
      results[preset] = { ok: true, ms: r.value.ms };
    } else {
      results[preset] = {
        ok: false,
        ms: 0,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    }
  });

  // After warming, build and send the daily digest email. Caches are now
  // warm so this reads from Redis (fast). Skip if ?skip_digest=1 is passed
  // (manual warmup runs shouldn't spam Fred's inbox).
  let digestResult: { sent: boolean; error?: string } = { sent: false };
  const skipDigest = url.searchParams.get('skip_digest') === '1';
  if (!skipDigest) {
    try {
      const todaySp = new URLSearchParams(); todaySp.set('range', 'today');
      const sevenSp = new URLSearchParams(); sevenSp.set('range', '7d');
      const fourteenSp = new URLSearchParams(); fourteenSp.set('range', '14d');
      const todayRange = parseDateRange(todaySp);
      const sevenRange = parseDateRange(sevenSp);
      const fourteenRange = parseDateRange(fourteenSp);

      const [todayHeadline, sevenHeadline, fourteenTop, messaged] = await Promise.all([
        getHeadlineMetrics(todayRange),
        getHeadlineMetrics(sevenRange),
        getTopProspects(fourteenRange),
        getMessagedSlugs(),
      ]);

      const actionQueue = fourteenTop
        .filter((p) => !messaged.has(p.prospect))
        .filter((p) => p.total_dwell_seconds >= 15 || p.cta_clicks > 0)
        .sort((a, b) => (a.last_view < b.last_view ? 1 : -1));

      const digest = await sendDigestEmail({
        actionQueue,
        totalEngagedToday: todayHeadline.engaged_reads,
        ctaClicksToday: todayHeadline.cta_clicks,
        ctaClicks7d: sevenHeadline.cta_clicks,
        memoViewsToday: todayHeadline.memo_views,
        memoViews7d: sevenHeadline.memo_views,
        hqUrl: 'https://rivett.tech/hq',
      });
      digestResult = digest.ok ? { sent: true } : { sent: false, error: digest.error };
    } catch (e) {
      digestResult = { sent: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return new Response(
    JSON.stringify({
      totalMs: Date.now() - started,
      warmed: toWarm,
      results,
      digest: digestResult,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
};

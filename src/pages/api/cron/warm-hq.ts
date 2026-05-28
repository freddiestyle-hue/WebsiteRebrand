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
import { Redis } from '@upstash/redis';
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
import { sendDigestEmail, sendHotAlertEmail } from '../../../utils/hq/notify';
import { isActionableProspect } from '../../../utils/hq/signal-filter';

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

// 24h dedupe so a sustained actionable prospect doesn't email Fred every
// time the cron runs. Distinct from the 30-min dedupe used by realtime
// CTA-click alerts — these signals accumulate, they don't burst.
const SIGNAL_DEDUPE_TTL = 24 * 60 * 60;

// Only fire if there's been activity in the last 24h. Prospects whose
// actionable status was earned days ago and have since gone quiet aren't
// actionable today.
const SIGNAL_RECENCY_HOURS = 24;

function dwellHuman(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function memoUrlFor(p: import('../../../utils/posthog/query').TopProspect): string {
  return p.surface === 'intake-review'
    ? `https://intake-reviews.vercel.app/intake-review/${p.prospect}`
    : `https://rivett.tech/audit/v3/${p.prospect}`;
}

// Fire HOT alerts for any prospect newly crossing an actionable threshold
// in the last 24h. Uses isActionableProspect from signal-filter so the
// alert criteria match every other surface (Action Center page, /hq
// banner, daily digest). One dedupe key per (signal type, prospect) so a
// prospect that drifts between signal types gets one alert per type.
async function fireSignalAlerts(
  prospects: import('../../../utils/posthog/query').TopProspect[]
): Promise<void> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const redis = url && token ? new Redis({ url, token }) : null;

  const recencyCutoff = Date.now() - SIGNAL_RECENCY_HOURS * 60 * 60 * 1000;

  for (const p of prospects) {
    const v = isActionableProspect(p);
    if (!v.actionable || !v.signal) continue;
    if (new Date(p.last_view).getTime() < recencyCutoff) continue;

    if (redis) {
      const key = `hq:notify:dedupe:${v.signal}:${p.prospect}`;
      try {
        const set = await redis.set(key, '1', { ex: SIGNAL_DEDUPE_TTL, nx: true });
        if (set !== 'OK') continue;
      } catch (e) {
        console.warn('[warm-hq] redis dedupe check failed, firing anyway', e);
      }
    }

    let signalLabel = '';
    let detail = '';
    if (v.signal === 'multi_viewer') {
      signalLabel = `Multi-viewer · ${p.distinct_visitors} people read this`;
      detail = `${p.distinct_visitors} distinct people, ${p.unique_sessions} session${p.unique_sessions === 1 ? '' : 's'}, ${p.total_views} view${p.total_views === 1 ? '' : 's'}, ${dwellHuman(p.total_dwell_seconds)} total dwell. Internal-forward shape — reach out today.`;
    } else if (v.signal === 'returning_engaged') {
      signalLabel = `Returning + engaged · ${p.unique_sessions} sessions`;
      detail = `Came back ${p.unique_sessions} times, ${dwellHuman(p.total_dwell_seconds)} total dwell${p.scroll_100s > 0 ? `, scrolled to bottom ${p.scroll_100s}×` : ''}${p.verdict_expansions > 0 ? `, expanded ${p.verdict_expansions} verdicts` : ''}. Sticky interest — worth a personalized DM.`;
    } else if (v.signal === 'cta_plus_engaged') {
      signalLabel = `CTA click + engaged · ${p.cta_clicks} click${p.cta_clicks === 1 ? '' : 's'}`;
      detail = `Clicked Book a call alongside ${dwellHuman(p.total_dwell_seconds)} dwell${p.scroll_100s > 0 ? ` and a full read` : ''}. Declared intent — follow up today.`;
    } else {
      // Unknown signal — skip rather than send a vague alert.
      continue;
    }

    await sendHotAlertEmail({
      prospect: p.prospect,
      signal: signalLabel,
      detail,
      memoUrl: memoUrlFor(p),
      hqUrl: 'https://rivett.tech/hq',
      whenIso: p.last_view,
    });
  }
}

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

      // Action Queue for the digest: every prospect that's actionable per
      // signal-filter AND hasn't been messaged. Same definition as
      // /action-center page so the email count matches the page count.
      // heat_score sort keeps multi-viewer + returning prospects above
      // bare CTA-plus rows.
      const actionQueue = fourteenTop
        .filter((p) => !messaged.has(p.prospect))
        .filter((p) => isActionableProspect(p).actionable)
        .sort((a, b) => {
          if (b.heat_score !== a.heat_score) return b.heat_score - a.heat_score;
          return a.last_view < b.last_view ? 1 : -1;
        });

      // HOT alerts: fire for any prospect crossing an actionable threshold
      // in the last 24h, deduped 24h per (signal-type, prospect). Same
      // criteria as the Action Center filter — one source of truth.
      try {
        await fireSignalAlerts(fourteenTop);
      } catch (e) {
        // Don't let alert failures break the digest path.
        console.error('[warm-hq] signal alert pass failed', e);
      }

      // Quiet-day skip: no signal = no email. Reduces inbox noise; aligns
      // with the "only act on signals that matter" principle. The HOT alert
      // path above is the real-time channel for unmissable events; this
      // daily digest is for "here's what's accumulated overnight."
      if (actionQueue.length === 0 && !url.searchParams.get('force_digest')) {
        digestResult = { sent: false, error: 'skipped: quiet day (no actionable signal)' };
      } else {
        const digest = await sendDigestEmail({
          actionQueue,
          totalEngagedToday: todayHeadline.engaged_reads,
          ctaClicksToday: todayHeadline.cta_clicks,
          ctaClicks7d: sevenHeadline.cta_clicks,
          memoViewsToday: todayHeadline.memo_views,
          memoViews7d: sevenHeadline.memo_views,
          hqUrl: 'https://rivett.tech/action-center',
        });
        digestResult = digest.ok ? { sent: true } : { sent: false, error: digest.error };
      }
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

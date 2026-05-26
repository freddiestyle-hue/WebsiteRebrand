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

export const GET: APIRoute = async ({ request }) => {
  const expected = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  // Vercel always sends the bearer. Allow manual triggering only if no
  // CRON_SECRET is set (local dev safety).
  if (expected && bearer !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const started = Date.now();
  const results: Record<string, { ok: boolean; ms: number; error?: string }> = {};

  // Warm each preset range sequentially so we don't hammer PostHog with 60
  // concurrent queries at once. Within a range, the 10 queries run in parallel.
  for (const preset of PRESETS) {
    const t0 = Date.now();
    try {
      await warmRange(preset.value);
      results[preset.value] = { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      results[preset.value] = {
        ok: false,
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return new Response(
    JSON.stringify({
      totalMs: Date.now() - started,
      results,
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
};

// Competitor-contrast endpoint. Hero-pattern: generate on first read, cache
// in KV forever on success. Differences from the hero endpoint, on purpose:
//
//  - ?generate=0 returns cache-or-404 fast: the memo page uses this during
//    SSR so a cold contrast never adds ~15s to a page load. A tiny client
//    script then fires the generate path after render, so the section
//    appears for the next visit (and the outreach pipeline primes it).
//  - Failures are cached too (1h TTL) so a dead prospect site or an
//    Anthropic outage can't make every page view re-burn Claude +
//    ScrapeCreators + SerpAPI credits. (The hero endpoint retries every
//    request on failure - deliberate there, too expensive here.)
//  - Gated on the memo existing in KV: arbitrary slugs can't trigger spend.

import type { APIRoute } from 'astro';
import { Redis } from '@upstash/redis';
import { isValidV3Slug } from '../../../../../utils/audit/slug';
import {
  buildCompetitorContrast,
  type CompetitorContrast,
} from '../../../../../utils/audit/competitor-contrast';

export const prerender = false;

const CACHE_KEY = (slug: string) => `audit-v3-competitors:${slug}`;
const FAIL_KEY = (slug: string) => `audit-v3-competitors-fail:${slug}`;
const FAIL_TTL_SECONDS = 60 * 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ params, url }) => {
  const slug = params.slug ?? '';
  if (!isValidV3Slug(slug)) return json(400, { error: 'invalid slug' });
  const readOnly = url.searchParams.get('generate') === '0';

  let redis: Redis;
  try {
    redis = Redis.fromEnv();
  } catch (e) {
    console.error('[api/competitors] KV unavailable', e);
    return json(500, { error: 'kv_unavailable' });
  }

  // 1. Cached contrast wins.
  try {
    const cached = await redis.get(CACHE_KEY(slug));
    if (cached != null) {
      const contrast: CompetitorContrast =
        typeof cached === 'string' ? JSON.parse(cached) : (cached as CompetitorContrast);
      return json(200, { contrast, cached: true });
    }
  } catch (e) {
    console.error('[api/competitors] cache read failed', e);
  }

  if (readOnly) return json(404, { error: 'not_generated' });

  // 2. Recent failure? Don't re-burn credits for an hour.
  try {
    const failed = await redis.get(FAIL_KEY(slug));
    if (failed != null) return json(404, { error: 'recently_failed' });
  } catch {
    /* non-fatal */
  }

  // 3. The memo must exist - this is the anti-abuse spend gate.
  let hostname = '';
  try {
    const raw = await redis.get(`audit-v3:${slug}`);
    if (raw == null) return json(404, { error: 'memo_not_found' });
    const payload = typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
    hostname = payload?.hostname || payload?.memo?.hostname || '';
  } catch (e) {
    console.error('[api/competitors] memo read failed', e);
    return json(500, { error: 'kv_read_failed' });
  }
  if (!hostname) return json(500, { error: 'memo_missing_hostname' });

  // 4. Fetch the prospect homepage (discovery input), then build.
  let homepageHtml = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(`https://${hostname}`, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        },
      });
      if (res.ok) homepageHtml = (await res.text()).slice(0, 900_000);
    } finally {
      clearTimeout(t);
    }
  } catch {
    /* discovery can still proceed with empty html -> will fail-open below */
  }

  const contrast = homepageHtml
    ? await buildCompetitorContrast(slug, hostname, homepageHtml)
    : null;

  if (!contrast) {
    try {
      await redis.set(FAIL_KEY(slug), '1', { ex: FAIL_TTL_SECONDS });
    } catch {
      /* non-fatal */
    }
    return json(404, { error: 'no_competitors' });
  }

  try {
    await redis.set(CACHE_KEY(slug), JSON.stringify(contrast));
  } catch (e) {
    console.error('[api/competitors] cache write failed', e);
  }
  return json(200, { contrast, cached: false });
};

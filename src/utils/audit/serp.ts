// Real Google indexed-page count via SerpAPI (Upgrade 11). Replaces the
// sitemap-size heuristic with an authoritative "site:domain.com" query so
// D-01 reports "X pages indexed by Google" instead of "X URLs in your
// sitemap". The two can differ wildly: a site can sitemap 200 pages and
// only have 30 indexed if Google deprioritised the rest.
//
// Cost: ~$0.005 per audit (SerpAPI free tier ~100 searches/month; paid
// plans bill per 1,000 searches). The Upstash 7-day cache absorbs most
// of the cost for repeat audits on the same prospect.
//
// Fails open: if SERPAPI_API_KEY is missing, the API errors, or the
// response is malformed, returns null. engine.ts treats null as "skip
// the pages-indexed check entirely" - the cell stays at its current
// 9-signal denominator rather than reporting a false zero.

import { Redis } from '@upstash/redis';

export interface SerpResult {
  // Total pages Google reports indexed for site:domain. null when SerpAPI
  // returned data but the field was absent or malformed.
  totalIndexed: number | null;
  // First 5 indexed URLs - used to verify the index quality (e.g. a site
  // showing only the homepage indexed has different problems than one
  // showing 500 well-distributed pages).
  sampleUrls: string[];
  // ISO timestamp when the data was fetched from SerpAPI (NOT the cache).
  // Lets the cell render "as of 2026-05-27" if we want freshness context.
  fetchedAt: string;
  // Where this result came from this read. cache = served from Upstash.
  source: 'serpapi' | 'cache';
}

const SERP_URL = 'https://serpapi.com/search';
const TIMEOUT_MS = 10000;
// 7-day TTL per the v3.5 spec. Indexed-page counts move slowly for most
// sites; a 7-day stale read is well within the noise of Google's own
// reporting (Search Console can be off by 20%+ on indexed pages day to day).
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

// Lazy Redis client. Construction is cheap but only build it once per
// lambda lifetime. Returns null when KV credentials are absent so the
// caller can still hit SerpAPI without caching (degraded but functional).
let _redis: Redis | null = null;
let _redisDisabled = false;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  if (_redisDisabled) return null;
  // Vercel KV uses KV_REST_API_* env vars; Redis.fromEnv() looks for
  // UPSTASH_REDIS_REST_* which aren't set. Build the client explicitly.
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    _redisDisabled = true;
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

// Normalise the domain for the cache key + SerpAPI query. Strips www.,
// lowercases, drops trailing slashes. Two different shapes of the same
// site (acme.com vs www.acme.com) should hit the same cache entry.
function normaliseDomain(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/\.+$/, '');
}

function cacheKey(domain: string): string {
  return `serp:site:${domain}`;
}

/**
 * Query Google's `site:domain.com` via SerpAPI and return the total
 * indexed-page count plus a sample of URLs. Caches successful results in
 * Upstash for 7 days. Returns null on any failure - missing API key,
 * timeout, HTTP error, malformed response - so the caller can degrade
 * gracefully without surfacing the failure to the prospect.
 */
export async function checkIndexedPages(hostname: string): Promise<SerpResult | null> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return null;

  const domain = normaliseDomain(hostname);
  if (!domain) return null;

  // Cache read first. A cache hit returns immediately; a miss falls through
  // to SerpAPI. KV errors are non-fatal - we'll just hit the API again.
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<SerpResult>(cacheKey(domain));
      if (cached) {
        return { ...cached, source: 'cache' };
      }
    } catch (e) {
      console.error('[serp] cache read failed', e);
    }
  }

  // SerpAPI fetch. num=10 keeps the response small - we only need the
  // total count and a few sample URLs, not the full result set.
  const params = new URLSearchParams({
    engine: 'google',
    q: `site:${domain}`,
    api_key: apiKey,
    num: '10',
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SERP_URL}?${params.toString()}`, { signal: ctrl.signal });
    if (!res.ok) {
      console.error(`[serp] HTTP ${res.status} for site:${domain}`);
      return null;
    }
    const data: unknown = await res.json();

    // Parse defensively. The SerpAPI response shape is documented but third-
    // party APIs change. Every field is checked before access.
    const totalIndexed = parseTotalResults(data);
    const sampleUrls = parseSampleUrls(data);

    // Some queries (very small sites, blocked sites, malformed input)
    // return success with no total. Treat as "ran successfully, no data"
    // rather than a hard failure - the cell can still render the URL
    // sample if present.
    const result: SerpResult = {
      totalIndexed,
      sampleUrls,
      fetchedAt: new Date().toISOString(),
      source: 'serpapi',
    };

    // Cache write. Fire-and-forget - a failed write doesn't change the
    // result the caller gets.
    if (redis) {
      try {
        await redis.set(cacheKey(domain), JSON.stringify(result), { ex: CACHE_TTL_SECONDS });
      } catch (e) {
        console.error('[serp] cache write failed', e);
      }
    }

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort')) {
      console.error(`[serp] timeout (${TIMEOUT_MS}ms) for site:${domain}`);
    } else {
      console.error(`[serp] fetch failed for site:${domain}`, e);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// SerpAPI returns total_results inside search_information. The field can
// be a number, a numeric string, or absent. Pure - exported for unit tests
// without standing up a real SerpAPI fixture.
export function parseTotalResults(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const si = (data as { search_information?: unknown }).search_information;
  if (!si || typeof si !== 'object') return null;
  const raw = (si as { total_results?: unknown }).total_results;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = parseInt(raw.replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// SerpAPI returns organic_results as an array; each entry has a link field.
// Pull the first 5 string links, skipping any that aren't strings.
export function parseSampleUrls(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const organic = (data as { organic_results?: unknown }).organic_results;
  if (!Array.isArray(organic)) return [];
  return organic
    .slice(0, 5)
    .map((r) => (r && typeof r === 'object' ? (r as { link?: unknown }).link : null))
    .filter((u): u is string => typeof u === 'string');
}

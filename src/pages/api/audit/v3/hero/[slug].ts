// JSON endpoint that returns the hero finding computed from a cached v3 audit.
// Used by scripts/bulk-audit.mjs to populate hero_dimension / hero_strength /
// hero_diagnosis columns in the bulk-output CSV without duplicating
// pick-hero.ts logic into JavaScript.
//
// The underlying Memo is already publicly accessible at /audit/v3/{slug}
// (rendered as HTML), so this JSON endpoint adds no new data surface - it
// just exposes the structured hero summary so callers don't have to scrape.

import type { APIRoute } from 'astro';
import { Redis } from '@upstash/redis';
import type { Memo } from '../../../../../utils/audit/memo-schema';
import { isValidV3Slug } from '../../../../../utils/audit/slug';
import { pickHeroFinding } from '../../../../../utils/audit/pick-hero';

export const prerender = false;

interface CachedV3 {
  memo: Memo;
  durationMs: number;
  scoreNumeric: number;
  scoreMax: number;
  hostname: string;
  url: string;
  fetchedAt: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? '';
  if (!isValidV3Slug(slug)) return json(400, { error: 'invalid slug' });

  let raw: unknown;
  try {
    const redis = Redis.fromEnv();
    raw = await redis.get(`audit-v3:${slug}`);
  } catch (e) {
    console.error('[api/audit/v3/hero] KV read failed', e);
    return json(500, { error: 'kv_read_failed' });
  }
  if (raw == null) return json(404, { error: 'not_found' });

  let payload: CachedV3;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : (raw as CachedV3);
  } catch (e) {
    return json(500, { error: 'kv_parse_failed' });
  }
  if (!payload?.memo) return json(500, { error: 'kv_missing_memo' });

  const hero = pickHeroFinding(payload.memo);

  return json(200, {
    slug,
    domain: payload.hostname,
    score: payload.scoreNumeric,
    scoreMax: payload.scoreMax,
    fetchedAt: payload.fetchedAt,
    hero: {
      dimension: hero.dimension,
      strength: hero.strength,
      cellHeading: hero.cellHeading,
      diagnosis: hero.diagnosis,
      oneLiner: hero.oneLiner,
      revenueMath: hero.revenueMath ?? null,
    },
  });
};

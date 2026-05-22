// JSON endpoint that serves the per-prospect teardown hero.
//
// Phase 1 rewrite. On request it returns the cached LLM hero
// (audit-v3-hero:{slug}). On a cache miss it loads the cached audit memo
// (audit-v3:{slug}), generates the hero with Claude Sonnet, caches it, and
// returns it. If generation fails or comes back ungrounded, generateHero
// returns null and the endpoint falls back to the rule-based pickHeroFinding,
// returning that WITHOUT caching so a later request retries the LLM.
//
// Rollback: flush audit-v3-hero:* in KV and every prospect instantly reverts
// to the rule-based hero - no deploy.

import type { APIRoute } from 'astro';
import { Redis } from '@upstash/redis';
import type { Memo } from '../../../../../utils/audit/memo-schema';
import { isValidV3Slug } from '../../../../../utils/audit/slug';
import { pickHeroFinding } from '../../../../../utils/audit/pick-hero';
import {
  generateHero,
  buildHeroUserPrompt,
  type HeroResult,
  type HeroPromptInput,
} from '../../../../../utils/audit/hero-llm';
import { evaluateHero, type HeroEvalResult } from '../../../../../utils/audit/hero-eval';
import { buildRevenueEstimate } from '../../../../../utils/audit/revenue-estimate';
import { buildIndustryContext } from '../../../../../utils/audit/icp-context';

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

interface CachedHero {
  slug: string;
  domain: string;
  hero: HeroResult;
  source: 'llm' | 'fallback';
  generatedAt: string;
  // Composite audit score, surfaced so the bulk-audit CSV (and the Airtable
  // sync downstream) has it without a second round trip to the memo.
  score: number;
  // Hero eval verdict (grounding, shape, anti-AI-tell). Set on the LLM path
  // only; the rule-based fallback is flagged by source instead. Observational,
  // not a gate - the hero ships regardless so the bulk run can review failures.
  evaluation?: HeroEvalResult;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// pickHeroFinding produces the rule-based HeroFinding; map it onto the hero
// shape the page and DM consume. The rule-based path has no "one thing they
// do well" line, so strength is left empty.
function fallbackHero(memo: Memo): { hero: HeroResult; dimension: string } {
  const hf = pickHeroFinding(memo);
  return {
    hero: { pageHero: hf.diagnosis, dmOneLiner: hf.oneLiner, strength: '' },
    dimension: hf.dimension,
  };
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? '';
  if (!isValidV3Slug(slug)) return json(400, { error: 'invalid slug' });

  let redis: Redis;
  try {
    redis = Redis.fromEnv();
  } catch (e) {
    console.error('[api/audit/v3/hero] KV unavailable', e);
    return json(500, { error: 'kv_unavailable' });
  }

  // 1. Serve the cached LLM hero if one exists.
  try {
    const cached = await redis.get(`audit-v3-hero:${slug}`);
    if (cached != null) {
      const hero: CachedHero =
        typeof cached === 'string' ? JSON.parse(cached) : (cached as CachedHero);
      return json(200, { ...hero, cached: true });
    }
  } catch (e) {
    console.error('[api/audit/v3/hero] hero cache read failed; regenerating', e);
  }

  // 2. Load the cached audit memo.
  let raw: unknown;
  try {
    raw = await redis.get(`audit-v3:${slug}`);
  } catch (e) {
    console.error('[api/audit/v3/hero] memo read failed', e);
    return json(500, { error: 'kv_read_failed' });
  }
  if (raw == null) return json(404, { error: 'not_found' });

  let payload: CachedV3;
  try {
    payload = typeof raw === 'string' ? JSON.parse(raw) : (raw as CachedV3);
  } catch {
    return json(500, { error: 'kv_parse_failed' });
  }
  if (!payload?.memo) return json(500, { error: 'kv_missing_memo' });

  // 3. Generate the LLM hero; cache it on success. The revenue estimate is
  //    computed deterministically here and handed to the prompt - the LLM may
  //    cite those figures but never does its own arithmetic. The hero input is
  //    built once so the same value can rebuild the prompt for evaluateHero.
  const heroInput: HeroPromptInput = {
    memo: payload.memo,
    revenueEstimate: buildRevenueEstimate(payload.memo),
    industryContext: buildIndustryContext(slug),
  };
  const llm = await generateHero(heroInput);
  if (llm) {
    // Evaluate after generation, never gate it: a hero that trips a check
    // still ships, flagged, so the bulk run can surface it for review rather
    // than silently swapping in a weaker rule-based hero.
    const evaluation = evaluateHero(llm, buildHeroUserPrompt(heroInput));
    const record: CachedHero = {
      slug,
      domain: payload.hostname,
      hero: llm,
      source: 'llm',
      generatedAt: new Date().toISOString(),
      score: payload.scoreNumeric,
      evaluation,
    };
    try {
      await redis.set(`audit-v3-hero:${slug}`, JSON.stringify(record));
    } catch (e) {
      console.error('[api/audit/v3/hero] hero cache write failed', e);
    }
    return json(200, { ...record, cached: false });
  }

  // 4. Fall back to the rule-based hero. NOT cached, so a later request
  //    retries the LLM. Flagged source:fallback for manual review before send.
  const fb = fallbackHero(payload.memo);
  return json(200, {
    slug,
    domain: payload.hostname,
    hero: fb.hero,
    fallbackDimension: fb.dimension,
    source: 'fallback',
    score: payload.scoreNumeric,
    cached: false,
  });
};

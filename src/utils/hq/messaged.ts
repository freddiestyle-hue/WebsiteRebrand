// Tracking of which prospects Fred has already followed up with.
//
// Backed by an Upstash Redis HASH so we can store the timestamp of each
// follow-up alongside the slug. Action Queue subtracts these prospects from
// the engaged-prospect list so each row is "what still needs your attention."
//
// Storage shape:
//   key: hq:messaged
//   field: <prospect slug>          e.g. "beaphar-co-uk"
//   value: ISO timestamp of message  e.g. "2026-05-26T18:42:00.000Z"
//
// Why a hash, not a set: we want to show "messaged 2h ago" later, and we
// want to allow un-marking (HDEL field). A set could do it but the hash
// makes the value semantically obvious.

import { Redis } from '@upstash/redis';

const MESSAGED_KEY = 'hq:messaged';

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

export interface MessagedRecord {
  slug: string;
  messagedAt: string;
}

/** Return the full set of messaged prospects with their timestamps. */
export async function getMessagedProspects(): Promise<MessagedRecord[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const obj = await redis.hgetall<Record<string, string>>(MESSAGED_KEY);
    if (!obj) return [];
    return Object.entries(obj).map(([slug, messagedAt]) => ({
      slug,
      messagedAt: String(messagedAt),
    }));
  } catch (e) {
    console.warn('[hq messaged] read failed', e);
    return [];
  }
}

/** Just the slugs, as a Set, for fast subtraction from prospect lists. */
export async function getMessagedSlugs(): Promise<Set<string>> {
  const records = await getMessagedProspects();
  return new Set(records.map((r) => r.slug));
}

/** Mark a prospect as messaged (idempotent — overwrites timestamp). */
export async function markMessaged(slug: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.hset(MESSAGED_KEY, { [slug]: new Date().toISOString() });
    return true;
  } catch (e) {
    console.warn('[hq messaged] write failed', slug, e);
    return false;
  }
}

/** Remove the messaged flag (puts prospect back in the action queue). */
export async function unmarkMessaged(slug: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.hdel(MESSAGED_KEY, slug);
    return true;
  } catch (e) {
    console.warn('[hq messaged] delete failed', slug, e);
    return false;
  }
}

/** Convert a prospect slug back into a likely DNS hostname. */
export function slugToDomain(slug: string): string {
  // Slugs are domains with dots replaced by hyphens, e.g.
  //   "beaphar-co-uk"     -> "beaphar.co.uk"
  //   "transit-technologies-com" -> "transit-technologies.com"
  //   "accentinns-com"   -> "accentinns.com"
  // Two-part TLDs (co-uk, com-au, etc.) handled first, then common single TLDs.
  // We do this by detecting the trailing TLD-shape rather than a wholesale
  // replace, so the company portion (e.g. "transit-technologies") keeps its
  // intra-name hyphens.
  const twoPartTlds: Record<string, string> = {
    'co-uk': '.co.uk',
    'co-za': '.co.za',
    'co-nz': '.co.nz',
    'co-il': '.co.il',
    'co-jp': '.co.jp',
    'com-au': '.com.au',
    'com-br': '.com.br',
    'com-mx': '.com.mx',
  };
  for (const [k, v] of Object.entries(twoPartTlds)) {
    if (slug.endsWith(`-${k}`)) {
      return slug.slice(0, -k.length - 1) + v;
    }
  }
  const singleTlds = ['com','io','net','org','ai','tech','app','us','biz','co','dev','xyz','me','tv','agency','digital','health','careers','city','careers','marketing','consulting'];
  for (const tld of singleTlds) {
    if (slug.endsWith(`-${tld}`)) {
      return slug.slice(0, -tld.length - 1) + `.${tld}`;
    }
  }
  // Unknown TLD — best-effort: replace last hyphen with a dot.
  const lastHyphen = slug.lastIndexOf('-');
  if (lastHyphen === -1) return slug;
  return slug.slice(0, lastHyphen) + '.' + slug.slice(lastHyphen + 1);
}

/** The prospect's actual website URL (best-effort, https://). */
export function prospectWebsiteUrl(slug: string): string {
  return `https://${slugToDomain(slug)}`;
}

/** Google search with site:linkedin.com filter — most reliable LinkedIn finder. */
export function findOnLinkedinUrl(slug: string): string {
  const domain = slugToDomain(slug);
  return `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com ${domain}`)}`;
}

/** @deprecated kept for backwards compat — same as findOnLinkedinUrl */
export function linkedinSearchUrl(slug: string): string {
  return findOnLinkedinUrl(slug);
}

/** @deprecated kept for backwards compat — same as findOnLinkedinUrl */
export function googleLinkedinUrl(slug: string): string {
  return findOnLinkedinUrl(slug);
}

/** Pretty company label for display (best-effort, from slug). */
export function slugToCompanyName(slug: string): string {
  return slugToDomain(slug);
}

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

/** Convert a prospect slug into a likely company-name search query. */
export function slugToCompanyName(slug: string): string {
  // Strip the TLD-style suffix at the end (co-uk, com, io, etc.) and
  // replace remaining hyphens with spaces. Slug "beaphar-co-uk" -> "beaphar".
  // Slug "transit-technologies-com" -> "transit technologies".
  return slug
    .replace(/-(com|co-uk|io|net|org|ai|tech|app|us|biz|co|us-com)$/i, '')
    .replace(/-/g, ' ');
}

/** LinkedIn people search URL for a prospect (best-effort name guess). */
export function linkedinSearchUrl(slug: string): string {
  const name = slugToCompanyName(slug);
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}`;
}

/** Build a Google site:linkedin.com URL — useful when LinkedIn search is noisy. */
export function googleLinkedinUrl(slug: string): string {
  const name = slugToCompanyName(slug);
  return `https://www.google.com/search?q=${encodeURIComponent('site:linkedin.com ' + name)}`;
}

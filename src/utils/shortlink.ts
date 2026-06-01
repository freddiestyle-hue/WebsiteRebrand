// URL shortener (Upgrade 13). Mints short codes like `k3x9` that resolve to
// full URLs server-side via /r/[code]. Used across every outbound surface
// (LinkedIn DMs, cold emails, future channels) so:
//
//   1. DMs stay short. `rivett.tech/r/k3x9` instead of
//      `rivett.tech/audit/v3/spok-com?utm_source=linkedin_dm&utm_recipient=...`
//   2. Per-recipient attribution. Each shortlink has its own KV record with
//      campaign + recipient + channel. Click_count > 1 = forwarded share.
//   3. Owned data. Every click fires PostHog `short_link_clicked` server-side
//      before the redirect, so even bouncers get tracked.
//   4. Reversible. Update the KV record to swap the destination after sending.
//      Delete it to deactivate.
//
// KV schema:
//   key:    shortlink:{code}
//   value:  { target, campaign, recipient, channel, created_at, created_by,
//             click_count, first_click_at, last_click_at, bot_click_count }
//   ttl:    none (manual cleanup if needed)
//
// Bot filter: LinkedIn/Slack/etc. unfurl previews hit the redirect server-side
// to fetch the OG card. Those count as `bot_click_count` (logged but not in
// the human click_count) and skip the PostHog event entirely.

import { Redis } from '@upstash/redis';

export interface ShortLinkMeta {
  /** The full URL to redirect to. Required. */
  target: string;
  /** Campaign name (e.g., 'wave1', 'wave2'). Free-form. */
  campaign?: string;
  /** Recipient identifier (e.g., 'claire@beaphar.co.uk', 'spok-com'). */
  recipient?: string;
  /** Channel (e.g., 'linkedin_dm', 'cold_email', 'twitter_dm', 'manual'). */
  channel?: string;
  /**
   * Marketing medium for utm_medium. Defaults to 'outreach' when unset, which
   * is correct for DMs and cold email. Blog/social distribution passes 'social'
   * so organic shares are not mislabeled as outbound.
   */
  medium?: string;
  /** Who/what minted this link (e.g., 'fred', 'hq_outreach_queue', 'python_gmail_script'). */
  created_by?: string;
}

export interface ShortLinkRecord extends ShortLinkMeta {
  created_at: string;
  click_count: number;
  first_click_at: string | null;
  last_click_at: string | null;
  bot_click_count: number;
}

// 4-char base36 alphabet = 1,679,616 combos. Sufficient to resist random-guess
// scraping at any reasonable scale. We collision-check on mint so the
// effective namespace is "unused slots only."
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 4;
const KV_KEY_PREFIX = 'shortlink:';

// Bots that unfurl OG cards. Their server-side fetches MUST not count as real
// human clicks. The pattern is the bot user-agent string fragment we look for.
// (case-insensitive substring check).
const BOT_UA_FRAGMENTS = [
  'linkedinbot',
  'facebookexternalhit',
  'facebot',
  'slackbot',
  'twitterbot',
  'whatsapp',
  'telegrambot',
  'discordbot',
  'redditbot',
  'tumblr',
  'embedly',
  'iframely',
  'preview',
  'unfurl',
  'bot/', // generic catch-all - skipd on a "/bot/" path fragment
  'crawler',
  'spider',
  'archive.org',
];

export function isBotUserAgent(ua: string | undefined | null): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  return BOT_UA_FRAGMENTS.some((frag) => lower.includes(frag));
}

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

// Pure code generator. Exported for testing. Generates a code from random
// bytes using rejection sampling so the distribution stays uniform over the
// 36-char alphabet (Math.random % 36 is biased; this isn't).
export function generateCode(length: number = CODE_LENGTH): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]);
  }
  return chars.join('');
}

// Sanitize user-supplied custom codes. Only alphanumerics, lowercase, length
// 2-32. Returns null if invalid. Used for vanity codes (`rivett.tech/r/claire`).
export function sanitizeCustomCode(input: string | undefined | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const clean = input.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  if (clean.length < 2) return null;
  return clean;
}

// Mint a new shortlink. With a custom code, fails if the code is already
// taken (no overwrite). With a generated code, retries on collision up to 5
// times before failing. Returns the code on success, null on failure.
export async function createShortLink(
  meta: ShortLinkMeta,
  customCode?: string | null,
): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  if (!meta.target || typeof meta.target !== 'string') return null;

  const now = new Date().toISOString();
  const record: ShortLinkRecord = {
    ...meta,
    created_at: now,
    click_count: 0,
    first_click_at: null,
    last_click_at: null,
    bot_click_count: 0,
  };

  if (customCode) {
    const clean = sanitizeCustomCode(customCode);
    if (!clean) return null;
    const exists = await redis.get(KV_KEY_PREFIX + clean).catch(() => null);
    if (exists) return null; // already taken
    await redis.set(KV_KEY_PREFIX + clean, JSON.stringify(record));
    return clean;
  }

  // Generated code path with collision retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const exists = await redis.get(KV_KEY_PREFIX + code).catch(() => null);
    if (exists) continue;
    await redis.set(KV_KEY_PREFIX + code, JSON.stringify(record));
    return code;
  }
  // 5 collisions in a row is astronomically unlikely with 1.7M slots and
  // fewer than ~10k existing links. Log and fail.
  console.error('[shortlink] 5 collisions in a row on code generation');
  return null;
}

// Look up a shortlink. Returns the full record or null when not found.
// Does NOT increment click counts - that's trackClick's job.
export async function resolveShortLink(code: string): Promise<ShortLinkRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  const clean = sanitizeCustomCode(code);
  if (!clean) return null;
  const raw = await redis.get<string | ShortLinkRecord>(KV_KEY_PREFIX + clean).catch(() => null);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as ShortLinkRecord) : raw;
  } catch {
    return null;
  }
}

// Increment click counts on the record. Splits human and bot. Fire-and-forget
// from the caller's perspective (the redirect doesn't wait).
export async function trackClick(code: string, isBot: boolean): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const clean = sanitizeCustomCode(code);
  if (!clean) return;
  const existing = await resolveShortLink(clean);
  if (!existing) return;
  const now = new Date().toISOString();
  const updated: ShortLinkRecord = isBot
    ? { ...existing, bot_click_count: existing.bot_click_count + 1 }
    : {
        ...existing,
        click_count: existing.click_count + 1,
        first_click_at: existing.first_click_at ?? now,
        last_click_at: now,
      };
  await redis.set(KV_KEY_PREFIX + clean, JSON.stringify(updated)).catch((e) => {
    console.error('[shortlink] click count update failed', e);
  });
}

// Append UTM params (and a `via=shortlink` marker) to the target URL on
// redirect. Existing query params are preserved; UTM keys overwrite to keep
// canonical attribution. Pure - exported for testing.
export function appendUtmParams(targetUrl: string, meta: ShortLinkMeta, code: string): string {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return targetUrl; // malformed target - return as-is, the redirect will 404
  }
  if (meta.channel) url.searchParams.set('utm_source', meta.channel);
  if (meta.campaign) url.searchParams.set('utm_campaign', meta.campaign);
  if (meta.recipient) url.searchParams.set('utm_recipient', meta.recipient);
  // Default to 'outreach' (DMs, cold email) for back-compat. Callers that are
  // not outreach - blog posts, social shares - pass an explicit medium.
  url.searchParams.set('utm_medium', meta.medium || 'outreach');
  url.searchParams.set('via', 'shortlink');
  url.searchParams.set('rl', code); // shortlink code itself - lets PostHog group multi-clicks
  return url.toString();
}

// Real-time webhook endpoint for HOT signals.
//
// Hit by PostHog Hog Function (CDP) when events match these criteria:
//   - cta_clicked on any /audit/* page  -> instant "HOT" email
//   - scroll_depth >= 75 on /audit/*    -> "deep read" email
//   - any other custom hot rule we add  -> generic prospect ping
//
// Auth via shared HQ_NOTIFY_SECRET header. PostHog sends it, we verify.
//
// Deduplication: same (prospect, signal-type) within 30 min only fires one
// email. Otherwise a chatty session would spam Fred. Stored in Redis with
// TTL = dedupe window.
//
// Body shape (from PostHog Hog Function):
//   {
//     prospect: string,        // slug, e.g. "beaphar-co-uk"
//     signal: string,          // "cta_click" | "deep_read" | "return_visit"
//     detail?: string,         // free-form
//     sessionId?: string,
//     city?: string, country?: string,
//     whenIso?: string,        // event timestamp; defaults to now
//   }

import type { APIRoute } from 'astro';
import { Redis } from '@upstash/redis';
import { sendHotAlertEmail } from '../../../utils/hq/notify';

export const prerender = false;

// PostHog session-replay URL pattern (matches the helper in query.ts)
const POSTHOG_PROJECT_ID = 373899;
function sessionReplayUrl(sid: string | null | undefined): string | null {
  if (!sid) return null;
  return `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/replay/${sid}`;
}

// Lazy redis used for dedupe. Same env-var pattern as messaged.ts.
let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

const DEDUPE_TTL_SECONDS = 30 * 60;

async function shouldFire(prospect: string, signal: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // no dedupe possible, always fire
  const key = `hq:notify:dedupe:${signal}:${prospect}`;
  try {
    // SET NX (only set if not exists). If we set, we're firing. If existed, skip.
    const set = await redis.set(key, '1', { ex: DEDUPE_TTL_SECONDS, nx: true });
    return set === 'OK';
  } catch {
    return true; // if Redis hiccups, fire anyway — better one extra email than none
  }
}

function humanSignal(signal: string): string {
  switch (signal) {
    case 'cta_click': return 'CTA click on Book a call';
    case 'deep_read': return 'Deep read (scrolled past 75%)';
    case 'return_visit': return 'Repeat visit to memo';
    case 'long_dwell': return 'Single session >2min dwell';
    default: return signal;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const expected = (process.env.HQ_NOTIFY_SECRET || '').trim();
  // Accept either header style PostHog might use.
  const secret =
    request.headers.get('x-hq-secret') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || (secret || '').trim() !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: {
    prospect?: string;
    signal?: string;
    detail?: string;
    sessionId?: string;
    city?: string;
    country?: string;
    whenIso?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const prospect = (body.prospect ?? '').trim();
  const signal = (body.signal ?? '').trim();
  if (!prospect || !signal) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Skip dedupe + email entirely when prospect is in Fred's own city set —
  // his own visits shouldn't trigger alerts. Cheap text check.
  const selfCities = ['Cape Town', 'Kleinmond'];
  if (body.city && selfCities.includes(body.city)) {
    return new Response(JSON.stringify({ ok: true, skipped: 'self_traffic' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const fire = await shouldFire(prospect, signal);
  if (!fire) {
    return new Response(JSON.stringify({ ok: true, deduped: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const result = await sendHotAlertEmail({
    prospect,
    signal: humanSignal(signal),
    detail: body.detail,
    replayUrl: sessionReplayUrl(body.sessionId ?? null),
    memoUrl: `https://rivett.tech/audit/v3/${prospect}`,
    hqUrl: 'https://rivett.tech/hq',
    whenIso: body.whenIso ?? new Date().toISOString(),
    city: body.city ?? null,
    country: body.country ?? null,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  });
};

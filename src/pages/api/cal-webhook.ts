// cal.com booking webhook -> server-side PostHog `call_booked` event.
//
// WHY THIS EXISTS: the on-site PostHog snippet can see a prospect CLICK
// "Book a call" (cta_clicked: v3_book_call) but NOT whether they actually
// booked - the booking completes on cal.com, off our domain. That left the
// funnel dead-ending at intent and conversion uninstrumented. This endpoint
// closes it: cal.com fires a webhook on every booking, we verify it, and emit
// `call_booked` into the SAME PostHog project (373899), attributed to the same
// prospect their memo views were identified under. Now /hq reads end-to-end:
// memo_view -> engaged_read -> v3_book_call -> call_booked.
//
// Server-to-server, so ad blockers are irrelevant and it fires even if the
// prospect closes the tab. Mirrors the capture pattern in src/pages/r/[code].ts.
//
// ATTRIBUTION (best-effort, multi-source, most-specific wins):
//   1. responses.prospect.value  - exact slug, IF we later add a hidden
//      `prospect` booking question to the event type and prefill it via
//      ?prospect=<slug> on the memo-page CTAs. Deterministic; survives the
//      random-suffix /audit/p/ slugs. (Not wired yet - see PHASE 2 below.)
//   2. work-email domain -> slug - `james@fresha.com` -> `fresha-com`, the
//      same v3 slug used in outreach links (/audit/v3/fresha-com). Covers the
//      dominant motion with zero cal.com config. Skipped for personal inboxes.
//   3. raw email - last resort so the booking is never lost, just less linked.
//
// PHASE 2 (deterministic attribution, optional): add a hidden `prospect`
// booking field on the discovery event type + thread ?prospect=${slug} into
// the memo CTAs (src/pages/audit/p/[slug].astro, /audit/v3/[slug].astro). Then
// source #1 fires and merges exactly, including suffixed /audit/p/ slugs.
//
// SECURITY: cal.com signs every delivery with HMAC-SHA256 over the raw body
// (header `x-cal-signature-256`). We verify it before emitting anything, so a
// random POST to this public URL can't inject fake conversions. Secret lives in
// CAL_WEBHOOK_SECRET (Vercel env), shared with the cal.com webhook config.

import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { normalizeDomainForSlug } from '../../utils/audit/slug';

export const prerender = false;

const POSTHOG_HOST = 'https://us.i.posthog.com';
// Public client token - safe to embed. Same key the in-browser PostHog uses.
const POSTHOG_CLIENT_KEY = 'phc_vqst8XDELjjTmFYwJiqzD7PzazzyQ9J69WJmcfJoxt27';

// Free/personal mailbox providers: a booking from one of these tells us nothing
// about the company, so we don't try to derive a company slug from the domain.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'msn.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'mail.com',
  'yandex.com', 'zoho.com', 'hey.com', 'fastmail.com',
]);

type CalAttendee = { email?: string; name?: string; timeZone?: string };
type CalResponse = { label?: string; value?: unknown };
type CalWebhook = {
  triggerEvent?: string;
  createdAt?: string;
  payload?: {
    uid?: string;
    type?: string;
    title?: string;
    startTime?: string;
    endTime?: string;
    attendees?: CalAttendee[];
    organizer?: { email?: string; name?: string; timeZone?: string };
    responses?: Record<string, CalResponse>;
    metadata?: Record<string, unknown>;
  };
};

export const POST: APIRoute = async ({ request }) => {
  const secret = (process.env.CAL_WEBHOOK_SECRET || '').trim();

  // Raw body is required for an exact HMAC - re-stringifying parsed JSON would
  // reorder keys and break the signature.
  const raw = await request.text();

  if (!secret) {
    // Misconfiguration on our side. Don't emit unverified events (spoofable),
    // and don't 500 cal.com into a retry storm - just log loudly.
    console.error('[cal-webhook] CAL_WEBHOOK_SECRET not set; ignoring delivery.');
    return json({ ok: true, note: 'webhook_secret_not_configured' });
  }

  const signature = request.headers.get('x-cal-signature-256') || '';
  if (!verifySignature(raw, signature, secret)) {
    console.error('[cal-webhook] signature mismatch; rejecting.');
    return json({ error: 'invalid signature' }, 401);
  }

  let body: CalWebhook;
  try {
    body = JSON.parse(raw) as CalWebhook;
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const trigger = body.triggerEvent ?? '';
  const eventName = TRIGGER_TO_EVENT[trigger];
  if (!eventName) {
    // PING / MEETING_STARTED / unknown - acknowledge so cal.com stays happy.
    return json({ ok: true, ignored: trigger || 'unknown' });
  }

  const p = body.payload ?? {};
  const attendee = p.attendees?.[0] ?? {};
  const email =
    cleanStr(attendee.email) ||
    cleanStr(p.responses?.email?.value) ||
    '';
  const name = cleanStr(attendee.name) || cleanStr(p.responses?.name?.value) || '';
  const emailDomain = email.includes('@') ? email.split('@')[1].toLowerCase() : '';

  const { distinctId, slug, method } = resolveIdentity(p.responses, email, emailDomain, p.uid);

  const captured = await capture({
    event: eventName,
    distinctId,
    properties: {
      booking_uid: p.uid ?? null,
      event_type: p.type ?? null,
      booking_title: p.title ?? null,
      start_time: p.startTime ?? null,
      end_time: p.endTime ?? null,
      attendee_email: email || null,
      attendee_name: name || null,
      attendee_domain: emailDomain || null,
      prospect_slug: slug,
      attribution_method: method,
      source: 'cal_webhook',
      // Person props so /hq can filter "prospects who booked" without scanning
      // the event stream. set_once keeps the first-booking timestamp stable.
      ...(eventName === 'call_booked'
        ? {
            $set: { booked_call: true, last_booked_at: p.startTime ?? body.createdAt ?? null },
            $set_once: { first_booked_at: p.startTime ?? body.createdAt ?? null },
          }
        : {}),
    },
    timestamp: body.createdAt,
  });

  if (!captured) {
    // Let cal.com retry rather than silently lose the money event. Duplicates
    // are de-dupable downstream by booking_uid.
    return json({ error: 'capture failed' }, 500);
  }

  return json({ ok: true, event: eventName, distinct_id: distinctId, attribution: method });
};

// --- helpers ---

const TRIGGER_TO_EVENT: Record<string, string> = {
  BOOKING_CREATED: 'call_booked',
  BOOKING_CANCELLED: 'call_cancelled',
  BOOKING_RESCHEDULED: 'call_rescheduled',
};

function resolveIdentity(
  responses: Record<string, CalResponse> | undefined,
  email: string,
  emailDomain: string,
  uid: string | undefined,
): { distinctId: string; slug: string | null; method: string } {
  // 1. Explicit prefilled `prospect` field (deterministic) - wins if present.
  const prefilled = cleanStr(responses?.prospect?.value);
  if (prefilled) return { distinctId: prefilled, slug: prefilled, method: 'prefill_field' };

  // 2. Work-email domain -> the same slug the v3 memo identified them under.
  if (emailDomain && !PERSONAL_EMAIL_DOMAINS.has(emailDomain)) {
    try {
      const derived = normalizeDomainForSlug(emailDomain);
      return { distinctId: derived, slug: derived, method: 'email_domain' };
    } catch {
      /* not a usable domain - fall through */
    }
  }

  // 3. Raw email so the booking is still captured, just loosely linked.
  if (email) return { distinctId: email, slug: null, method: 'email_raw' };

  // 4. Nothing usable - anchor to the booking id so the event still lands.
  return { distinctId: uid ? `cal_${uid}` : 'cal_unknown', slug: null, method: 'none' };
}

async function capture(opts: {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  timestamp?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_CLIENT_KEY,
        event: opts.event,
        distinct_id: opts.distinctId,
        properties: opts.properties,
        timestamp: opts.timestamp ?? new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.error('[cal-webhook] PostHog capture non-200', res.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[cal-webhook] PostHog capture threw', e);
    return false;
  }
}

function verifySignature(raw: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  // Both must be equal-length hex for timingSafeEqual; guard against malformed.
  if (signature.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function cleanStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// POST /api/r/create — mint a new shortlink. Auth-protected. The single
// entry point every outreach surface uses, no matter the channel:
//
//   - /hq Send Queue calls this when the operator clicks "Copy DM"
//   - Python Gmail-draft scripts call this when building cold-email bodies
//   - Manual outreach scripts call this when staging a batch
//   - Future channels (Twitter DM, SMS, in-app msg) call this
//
// All shortlinks land in the same KV namespace, ensuring per-recipient
// attribution works uniformly across surfaces.
//
// Auth: Bearer header with RIVETT_AUDIT_TOKEN OR HQ_KEY. Both env vars
// already in Vercel production for other endpoints.
//
// Request:
//   POST /api/r/create
//   Authorization: Bearer <RIVETT_AUDIT_TOKEN>
//   Content-Type: application/json
//   {
//     "target_url": "https://rivett.tech/audit/v3/spok-com",
//     "campaign": "wave1",          // optional
//     "recipient": "claire",        // optional
//     "channel": "linkedin_dm",     // optional - becomes utm_source
//     "medium": "social",           // optional - utm_medium, defaults to 'outreach'
//     "custom_code": "claire-spok", // optional - vanity code
//     "created_by": "hq_operator"   // optional - attribution
//   }
//
// Response:
//   200 { "short_url": "https://rivett.tech/r/k3x9", "code": "k3x9" }
//   400 { "error": "bad_request", "detail": "..." }
//   401 { "error": "unauthorized" }
//   500 { "error": "mint_failed" }

import type { APIRoute } from 'astro';
import { createShortLink } from '../../../utils/shortlink';

export const prerender = false;

const SHORT_BASE = 'https://rivett.tech/r/';

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

function badRequest(detail: string): Response {
  return new Response(JSON.stringify({ error: 'bad_request', detail }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

function checkAuth(request: Request): boolean {
  const audit = process.env.RIVETT_AUDIT_TOKEN;
  const hq = process.env.HQ_KEY;

  // Path 1: Bearer header (server-side callers - Python scripts, curl, etc.)
  const auth = request.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (m) {
    const token = m[1].trim();
    if (audit && token === audit) return true;
    if (hq && token === hq) return true;
  }

  // Path 2: rivett_hq_key cookie (in-browser callers from /hq pages - matches
  // the auth pattern used by /api/hq/mark-messaged).
  if (hq) {
    const cookieHeader = request.headers.get('cookie') ?? '';
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)rivett_hq_key=([^;]+)/);
    const cookieKey = (cookieMatch?.[1] ?? '').trim();
    if (cookieKey && cookieKey === hq) return true;
  }

  return false;
}

export const POST: APIRoute = async ({ request }) => {
  if (!checkAuth(request)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  const target = typeof body.target_url === 'string' ? body.target_url.trim() : '';
  if (!target) return badRequest('target_url_required');

  // Validate target URL parses. Otherwise we'd mint a code that redirects to
  // garbage, which corrupts the operator's outreach.
  try {
    const u = new URL(target);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return badRequest('target_url_must_be_http_or_https');
    }
  } catch {
    return badRequest('target_url_unparseable');
  }

  const campaign = typeof body.campaign === 'string' ? body.campaign.trim().slice(0, 80) : undefined;
  const recipient = typeof body.recipient === 'string' ? body.recipient.trim().slice(0, 120) : undefined;
  const channel = typeof body.channel === 'string' ? body.channel.trim().slice(0, 60) : undefined;
  const medium = typeof body.medium === 'string' ? body.medium.trim().slice(0, 60) : undefined;
  const created_by = typeof body.created_by === 'string' ? body.created_by.trim().slice(0, 60) : undefined;
  const custom_code = typeof body.custom_code === 'string' ? body.custom_code : undefined;

  const code = await createShortLink(
    { target, campaign, recipient, channel, medium, created_by },
    custom_code,
  );

  if (!code) {
    // Either KV unreachable, custom_code taken, or 5 random collisions in a
    // row. The 3 cases are rare and recoverable; the caller retries.
    return new Response(JSON.stringify({ error: 'mint_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ short_url: `${SHORT_BASE}${code}`, code }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
};

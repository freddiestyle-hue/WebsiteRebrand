// POST endpoint that flips a prospect's Outreach Stage. Single source of
// truth is the Airtable Prospects table - the legacy Redis "hq:messaged"
// hash is no longer consulted.
//
// Body: { slug: string, action: "mark" | "unmark", stage?: string }
//   - action=mark sets stage (default "Sent"; OutreachQueue sends "Connection Sent")
//   - action=unmark sets stage to "Not Sent"
//   - explicit stage param wins over the default for mark
// Auth: same rivett_hq_key cookie that gates /hq. Without it, returns 401.
// Response: { ok: boolean, slug, action, stage }

import type { APIRoute } from 'astro';
import { getProspectBySlug, setOutreachStage } from '../../../utils/hq/airtable';

export const prerender = false;

function isAuthed(request: Request): boolean {
  const expected = (process.env.HQ_KEY || import.meta.env.HQ_KEY || '').trim();
  if (!expected) return false;
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)rivett_hq_key=([^;]+)/);
  const cookieKey = (match?.[1] ?? '').trim();
  return cookieKey === expected;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthed(request)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: { slug?: string; action?: string; stage?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const slug = (body.slug ?? '').trim();
  if (!slug || slug.length > 200) {
    return new Response(JSON.stringify({ error: 'bad_slug' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Allowlist of Outreach Stage values the API will set, matching the
  // Prospects table's singleSelect choices. Anything else is silently
  // coerced to the legacy default so a bad request can never write an
  // unknown choice (which Airtable rejects with typecast=true off and
  // creates a new option with typecast=true on).
  const ALLOWED_STAGES = new Set([
    'Not Sent', 'Drafted', 'Connection Sent', 'Connection Accepted',
    'Sent', 'Bumped', 'Replied', 'Booked', 'Won', 'Lost', 'Disqualified',
  ]);
  const action = body.action === 'unmark' ? 'unmark' : 'mark';
  const requestedStage = (body.stage ?? '').trim();
  const defaultStage = action === 'mark' ? 'Sent' : 'Not Sent';
  const stage = ALLOWED_STAGES.has(requestedStage) ? requestedStage : defaultStage;

  // Look up the Airtable record for this slug.
  const prospect = await getProspectBySlug(slug);
  if (!prospect || !prospect.recordId) {
    return new Response(JSON.stringify({
      error: 'no_airtable_record',
      message: 'This slug isn\'t in the Prospects table, so there\'s no Outreach Stage to flip. Add the prospect to Airtable first.',
    }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ok = await setOutreachStage(prospect.recordId, stage);

  return new Response(JSON.stringify({ ok, slug, action, stage }), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  });
};

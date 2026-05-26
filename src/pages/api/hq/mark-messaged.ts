// POST endpoint that flips a prospect to "messaged" (or back).
//
// Body: { slug: string, action: "mark" | "unmark" }
// Auth: same rivett_hq_key cookie that gates /hq. Without it, returns 401.
// Response: { ok: boolean, slug, action }
//
// Used by the Action Queue component on /hq. Click "✓ messaged" → POST here,
// page is re-fetched, prospect drops off the queue on next render.

import type { APIRoute } from 'astro';
import { markMessaged, unmarkMessaged } from '../../../utils/hq/messaged';

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

  let body: { slug?: string; action?: string };
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

  const action = body.action === 'unmark' ? 'unmark' : 'mark';
  const ok = action === 'mark' ? await markMessaged(slug) : await unmarkMessaged(slug);

  return new Response(JSON.stringify({ ok, slug, action }), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  });
};

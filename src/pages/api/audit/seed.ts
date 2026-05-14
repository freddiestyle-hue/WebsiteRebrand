// Authenticated memo-seed endpoint.
//
// POSTs a memo JSON payload into Upstash KV at `memo:${slug}` so the
// /audit/p/{slug} renderer can pick it up. Same Bearer-auth model as
// /api/audit/check. Validates the body against MemoSchema before writing,
// so we don't poison KV with a malformed memo that would 500 the renderer.
//
// Defensive .trim() on the expected token because earlier env writes used
// `echo $TOKEN | vercel env add` which left a trailing newline in the
// stored value. Comparing against the trimmed value still rejects truly
// wrong tokens but tolerates that one historical config wart.

import type { APIRoute } from 'astro';
import { Redis } from '@upstash/redis';
import { MemoSchema, type Memo } from '../../../utils/audit/memo-schema';

export const prerender = false;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
}

function checkAuth(req: Request): { ok: true } | { ok: false; status: number; reason: string } {
  const rawExpected = import.meta.env.RIVETT_AUDIT_TOKEN ?? process.env.RIVETT_AUDIT_TOKEN;
  if (!rawExpected) {
    return { ok: false, status: 503, reason: 'Endpoint disabled: RIVETT_AUDIT_TOKEN not set.' };
  }
  const expected = rawExpected.trim();
  const header = req.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, reason: 'Missing Bearer token.' };
  }
  const provided = header.slice(7).trim();
  if (provided !== expected) {
    return { ok: false, status: 401, reason: 'Invalid token.' };
  }
  return { ok: true };
}

export const POST: APIRoute = async ({ request }) => {
  const auth = checkAuth(request);
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.reason });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Body must be valid JSON.' });
  }

  const parsed = MemoSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(400, {
      error: 'Memo failed schema validation.',
      issues: parsed.error.flatten(),
    });
  }

  const memo: Memo = parsed.data;

  try {
    const redis = Redis.fromEnv();
    const key = `memo:${memo.slug}`;
    await redis.set(key, JSON.stringify(memo));
    return jsonResponse(200, {
      ok: true,
      slug: memo.slug,
      key,
      url: `https://rivett.tech/audit/p/${memo.slug}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[api/audit/seed] KV write failed', e);
    return jsonResponse(500, { error: `KV write failed: ${message}` });
  }
};

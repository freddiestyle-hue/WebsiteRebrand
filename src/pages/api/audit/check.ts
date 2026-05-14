import type { APIRoute } from 'astro';
import { runAudit, rankedRecommendations } from '../../../utils/audit/engine';

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

async function handle(url: string): Promise<Response> {
  if (!url) return jsonResponse(400, { error: 'Missing url parameter.' });
  if (typeof url !== 'string') return jsonResponse(400, { error: 'url must be a string.' });

  try {
    const result = await runAudit(url);
    const recommendations = rankedRecommendations(result);
    return jsonResponse(200, { result, recommendations });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[api/audit/check] runAudit failed', e);
    return jsonResponse(500, { error: message });
  }
}

export const GET: APIRoute = async ({ request, url }) => {
  const auth = checkAuth(request);
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.reason });
  return handle(url.searchParams.get('url') ?? '');
};

export const POST: APIRoute = async ({ request }) => {
  const auth = checkAuth(request);
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.reason });
  let body: { url?: string } = {};
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return jsonResponse(400, { error: 'Body must be valid JSON.' });
  }
  return handle(body.url ?? '');
};

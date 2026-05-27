// POST endpoint that LLM-generates a LinkedIn DM or email for a prospect.
//
// Body: { slug: string, channel: "linkedin" | "email", signals: DraftSignals }
// Auth: same rivett_hq_key cookie that gates /hq. Without it, returns 401.
// Response: { ok: true, subject: string, body: string, cached: boolean }
//
// Looks up the prospect's full info across all Airtable tables, builds a
// hyper-personalized message referencing their engagement behaviour and any
// audit findings, returns the draft. Cached per (slug, channel) for 5 min
// to keep re-clicks instant + cheap.

import type { APIRoute } from 'astro';
import { getProspectBySlug, type ProspectInfo } from '../../../utils/hq/airtable';
import { generateDraft, type Channel, type DraftSignals } from '../../../utils/hq/draft';
import { slugToDomain } from '../../../utils/hq/messaged';

export const prerender = false;

function isAuthed(request: Request): boolean {
  const expected = (process.env.HQ_KEY || import.meta.env.HQ_KEY || '').trim();
  if (!expected) return false;
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)rivett_hq_key=([^;]+)/);
  const cookieKey = (match?.[1] ?? '').trim();
  return cookieKey === expected;
}

function normalizeSignals(input: unknown): DraftSignals {
  const s = (input ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    total_dwell_seconds: num(s.total_dwell_seconds),
    unique_sessions: num(s.unique_sessions),
    total_views: num(s.total_views),
    cta_clicks: num(s.cta_clicks),
    verdict_expansions: num(s.verdict_expansions),
    scroll_100s: num(s.scroll_100s),
    copies: num(s.copies),
    prints: num(s.prints),
    return_visitor: Boolean(s.return_visitor),
    last_view: typeof s.last_view === 'string' ? s.last_view : '',
  };
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAuthed(request)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: { slug?: string; channel?: string; signals?: unknown };
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

  const channel: Channel = body.channel === 'email' ? 'email' : 'linkedin';
  const signals = normalizeSignals(body.signals);
  const force = Boolean((body as { force?: unknown }).force);

  // Prefer the rich Airtable record, but if the slug isn't in any prospecting
  // table, draft from engagement signals + the slug-derived domain. Better to
  // hand Fred a usable draft than a 404.
  let prospect = await getProspectBySlug(slug);
  const hasAirtableRecord = !!prospect;
  if (!prospect) {
    const domain = slugToDomain(slug);
    prospect = minimalProspect(slug, domain);
  }

  const draft = await generateDraft(prospect, signals, channel, { force });

  return new Response(JSON.stringify({
    ok: true,
    subject: draft.subject,
    body: draft.body,
    cached: draft.cached,
    has_airtable_record: hasAirtableRecord,
    prospect: {
      firstName: prospect.firstName,
      title: prospect.title,
      company: prospect.company,
      email: prospect.email,
      linkedinUrl: prospect.linkedinUrl,
      source: prospect.source,
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

/**
 * Build a stub ProspectInfo from a slug alone, used when no Airtable record
 * exists. Engagement signals + slug-derived domain become the only context
 * the LLM has to work with, but that's still better than a 404.
 */
function minimalProspect(slug: string, domain: string): ProspectInfo {
  return {
    slug,
    vertical: '',
    source: 'No Airtable record',
    displayName: domain,
    firstName: '',
    title: '',
    company: domain,
    industry: '',
    email: '',
    linkedinUrl: '',
    outreachStage: '',
    linkedinDm: '',
    linkedinFollowupDm: '',
    emailSubject: '',
    emailBody: '',
    auditContext: '',
    sentAt: '',
    repliedAt: '',
    recordId: '',
  };
}

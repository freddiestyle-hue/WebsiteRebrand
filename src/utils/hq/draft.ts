// LLM message drafting for HQ Action Queue.
//
// Generates a hyper-personalized LinkedIn DM or email referencing what the
// prospect actually did on their audit memo (dwell, verdicts expanded, etc.)
// plus what we know about their specific gaps from Airtable.
//
// Voice rules pulled from project memory (non-negotiable):
//   - No em dashes. Use commas, periods, sentence breaks, or hyphens.
//   - No emoji.
//   - Lowercase-conversational, no marketing fluff, no "hope you're well".
//   - Reference ONE specific behaviour OR ONE audit finding, not a list.
//
// Cost / latency: ~$0.002 per call with Claude Sonnet 4.7, ~2-4s round-trip.
// Cached per (slug, channel) for 5 minutes so re-clicking doesn't re-bill.

import Anthropic from '@anthropic-ai/sdk';
import { Redis } from '@upstash/redis';
import type { ProspectInfo } from './airtable';

const MODEL = 'claude-sonnet-4-6';
const CACHE_TTL_SECONDS = 300; // 5 min

export type Channel = 'linkedin' | 'email';

export interface DraftSignals {
  total_dwell_seconds: number;
  unique_sessions: number;
  total_views: number;
  cta_clicks: number;
  verdict_expansions: number;
  scroll_100s: number;
  copies: number;
  prints: number;
  return_visitor: boolean;
  last_view: string;
}

export interface DraftResult {
  subject: string;  // empty string for LinkedIn
  body: string;
  cached: boolean;
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

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (_client) return _client;
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return null;
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export async function generateDraft(
  prospect: ProspectInfo,
  signals: DraftSignals,
  channel: Channel,
  opts?: { force?: boolean }
): Promise<DraftResult> {
  const cacheKey = `hq:draft:${prospect.slug}:${channel}`;
  const redis = getRedis();
  const force = !!(opts && opts.force);
  if (redis && !force) {
    try {
      const hit = await redis.get<{ subject: string; body: string }>(cacheKey);
      if (hit && hit.body) return { ...hit, cached: true };
    } catch (e) {
      console.warn('[hq draft] cache read failed', e);
    }
  }

  const client = getClient();
  if (!client) {
    return { subject: '', body: 'ANTHROPIC_API_KEY not configured.', cached: false };
  }

  const prompt = buildPrompt(prospect, signals, channel);
  let body = '';
  let subject = '';
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    // Extract text content from the response.
    const text = res.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();

    const parsed = parseModelOutput(text, channel);
    subject = parsed.subject;
    body = parsed.body;
  } catch (e) {
    console.error('[hq draft] LLM call failed', e);
    return {
      subject: '',
      body: `Could not draft message: ${e instanceof Error ? e.message : String(e)}`,
      cached: false,
    };
  }

  // Cache successful results only.
  if (redis && body && !body.startsWith('Could not')) {
    redis.set(cacheKey, { subject, body }, { ex: CACHE_TTL_SECONDS }).catch((e) => {
      console.warn('[hq draft] cache write failed', e);
    });
  }

  return { subject, body, cached: false };
}

// --------------------------------------------------------------------------
// Prompt
// --------------------------------------------------------------------------

const SYSTEM_PROMPT = `You write SHORT, action-driving follow-up DMs for Fred Style at Rivett (rivett.tech).

The recipient has ALREADY READ the audit. Do NOT re-explain what's in it. They saw it.

Your job: get them on a 15-30 min call. That's it.

Voice rules (non-negotiable):
- LinkedIn DM body: 180-320 characters. Email body: 50-110 words. Stay under.
- 2-3 sentences max. No paragraphs.
- ONE line acknowledging what they did (came back, scrolled, expanded, etc.). Specific, not generic.
- ONE line that names the gap-they-care-about generically (NOT a recap of the audit's findings). Example: "the tracking gap" or "the page-speed thing" or "the conversion side." A pointer, not a re-read.
- ONE direct ask. "Worth a quick call?" or "15 min?" or "Want to walk through it?" Always end on a question.
- No em dashes. No emoji. Lowercase-conversational.
- Skip "hope you're well", "just wanted to", "I wanted to reach out".
- Do NOT include the cal.com link, the audit URL, or any other links. Fred adds those by hand. The body is text only.
- Do NOT list findings. Do NOT include numbers, percentages, or product names from the audit. The prospect already saw those.

Examples of the right shape:

"heidi, you came back twice. that probably means the tracking gap is the one worth talking through. 15 min this week?"

"claire, you went all the way to the bottom of the memo and expanded the verdicts. quickest path is a quick walk-through of the fix order. worth a call?"

"frank, you opened it twice but didn't scroll much. happy to do a 10 min call where I just hit the headline findings instead. interested?"

Output strictly as JSON: {"subject": "...", "body": "..."}
- LinkedIn: subject is "". Body 180-320 chars.
- Email: subject is 4-6 lowercase words, no punctuation at end. Body 50-110 words.
- Return ONLY the JSON. No preamble, no markdown fences.`;

function buildPrompt(
  prospect: ProspectInfo,
  signals: DraftSignals,
  channel: Channel
): string {
  const lines: string[] = [];
  lines.push(`Channel: ${channel}`);
  lines.push('');
  lines.push('PROSPECT');
  lines.push(`- Name: ${prospect.firstName || '(unknown - greet with title or company)'}`);
  if (prospect.title) lines.push(`- Title: ${prospect.title}`);
  lines.push(`- Company: ${prospect.company || prospect.slug}`);
  if (prospect.industry) lines.push(`- Industry: ${prospect.industry}`);
  if (prospect.source) lines.push(`- Play: ${prospect.source}`);
  if (prospect.outreachStage) lines.push(`- Outreach stage so far: ${prospect.outreachStage}`);
  lines.push('');

  lines.push('WHAT THEY DID ON THE AUDIT (use ONE in your one-line acknowledgement)');
  const behaviors = describeSignals(signals);
  if (behaviors.length === 0) {
    lines.push('- They opened the memo. Nothing else recorded. Acknowledge generically: "you opened it."');
  } else {
    for (const b of behaviors) lines.push(`- ${b}`);
  }
  lines.push('');

  // Pick the strongest finding-dimension as the generic gap pointer — used as
  // a category hint only, never quoted verbatim. The LLM should reference
  // "the tracking thing" or "the conversion side," not the literal text.
  if (prospect.auditContext) {
    const dimHint = inferGapCategory(prospect.auditContext);
    if (dimHint) {
      lines.push(`GENERIC GAP CATEGORY (point at this, do NOT quote the audit): ${dimHint}`);
      lines.push('');
    }
  }

  lines.push(
    channel === 'linkedin'
      ? 'Write a LinkedIn DM. 180-320 chars, 2-3 sentences. End with a question asking for a short call. No links, no numbers, no audit recap.'
      : 'Write an email. Subject 4-6 lowercase words. Body 50-110 words, 2-4 sentences. End with a question asking for a short call. No links, no numbers, no audit recap.'
  );

  return lines.join('\n');
}

// Pick a coarse gap category from the audit findings text. The LLM uses this
// to point at the right kind of issue ("the tracking gap", "the page-speed
// thing") without rehashing specifics.
function inferGapCategory(auditContext: string): string {
  const ctx = auditContext.toLowerCase();
  const hits: string[] = [];
  if (/tracking|gtm|insight tag|ga4|pixel/.test(ctx)) hits.push('the tracking gap');
  if (/pagespeed|load time|lcp|render/.test(ctx)) hits.push('the page-speed thing');
  if (/conversion|cta|form|booking/.test(ctx)) hits.push('the conversion side');
  if (/seo|aeo|crawl|schema/.test(ctx)) hits.push('the discovery / SEO piece');
  if (/email|deliverab|spf|dmarc/.test(ctx)) hits.push('the email deliverability angle');
  if (/ads|paid|landing/.test(ctx)) hits.push('the paid-ads side');
  if (/mobile/.test(ctx)) hits.push('the mobile experience');
  return hits[0] || '';
}

function describeSignals(s: DraftSignals): string[] {
  // Behaviour pointers the LLM picks ONE from. Phrased as the natural-language
  // line that can drop straight into the DM. Avoid raw numbers / counts so the
  // model doesn't itemise. "Came back twice" is fine; "spent 56s" is not.
  const out: string[] = [];
  if (s.cta_clicks > 0) out.push(`hit the book-a-call CTA`);
  if (s.prints > 0) out.push(`printed it (saving for later)`);
  if (s.copies > 0) out.push(`copied a chunk out of it (probably forwarding internally)`);
  if (s.return_visitor && s.unique_sessions >= 3) out.push(`came back three or more times`);
  else if (s.return_visitor) out.push(`came back twice`);
  if (s.scroll_100s > 0) out.push(`went all the way to the bottom`);
  if (s.verdict_expansions > 0) out.push(`expanded the verdict cells`);
  if (s.total_dwell_seconds >= 120) out.push(`spent real time on it`);
  else if (s.total_dwell_seconds >= 30) out.push(`gave it a real look`);
  return out;
}

// --------------------------------------------------------------------------
// Output parsing - the model should return JSON, but be defensive.
// --------------------------------------------------------------------------

function parseModelOutput(text: string, channel: Channel): { subject: string; body: string } {
  // Strip markdown code fences if the model added them.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    const obj = JSON.parse(cleaned) as { subject?: string; body?: string };
    return {
      subject: channel === 'linkedin' ? '' : String(obj.subject || '').trim(),
      body: String(obj.body || '').trim(),
    };
  } catch {
    // Fallback: assume the raw text is the body.
    return { subject: '', body: cleaned };
  }
}

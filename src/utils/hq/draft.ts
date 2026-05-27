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

const MODEL = 'claude-sonnet-4-7';
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

const SYSTEM_PROMPT = `You write outbound sales messages on behalf of Fred Style at Rivett (rivett.tech).

About Rivett: Fred builds automated pipeline systems (AI agents) for SMB operators. He used to run growth at Somewhere.com under Nick Huber. Rivett sells fractional embedded leadership, 3-4 clients max, $8-15k/month retainers. The wedge is a free 30-minute audit of the prospect's marketing stack.

Voice rules (non-negotiable):
- No em dashes. Use commas, periods, sentence breaks, or hyphens instead.
- No emoji.
- Lowercase-conversational. No corporate fluff.
- Skip openers like "Hope you're well" or "I hope this finds you well".
- Reference ONE specific thing they did on the audit memo OR ONE specific audit finding. Not a list. Make it feel like you noticed them, not blasted them.
- Sentences short. Vary length. Don't stack three short sentences in a row (that's an AI tell).
- No rule-of-three patterns. No "we do X. we do Y. we do Z."
- End with one specific small ask, not "let me know if interested."

Output strictly as JSON: {"subject": "...", "body": "..."}
- For LinkedIn, subject is "". Body 600-900 characters.
- For email, subject is 4-7 lowercase words, no punctuation at the end. Body 4-7 sentences, 80-150 words.
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

  lines.push('WHAT THEY DID ON THE AUDIT MEMO');
  const behaviors = describeSignals(signals);
  if (behaviors.length === 0) {
    lines.push('- They opened it but signals are thin. Reference the audit you sent, do not invent behaviour.');
  } else {
    for (const b of behaviors) lines.push(`- ${b}`);
  }
  lines.push('');

  if (prospect.auditContext) {
    lines.push('AUDIT FINDINGS (use one of these as a hook if relevant)');
    // Trim auditContext to a sane size so we do not blow tokens
    const ctx = prospect.auditContext.length > 1500
      ? prospect.auditContext.slice(0, 1500) + '\n...'
      : prospect.auditContext;
    lines.push(ctx);
    lines.push('');
  }

  // Show any existing canned message as a STYLE anchor, not content to copy.
  const styleAnchor = prospect.linkedinDm || prospect.linkedinFollowupDm || prospect.emailBody;
  if (styleAnchor) {
    lines.push('STYLE ANCHOR (match this voice, do not copy the content)');
    lines.push(styleAnchor.slice(0, 800));
    lines.push('');
  }

  lines.push(
    channel === 'linkedin'
      ? 'Write a LinkedIn DM. They have already engaged with the audit, so this is a post-engagement nudge, not a cold connection request.'
      : 'Write an email. Subject is short and lowercase. Body has a specific opening hook from their behaviour or an audit finding.'
  );

  return lines.join('\n');
}

function describeSignals(s: DraftSignals): string[] {
  const out: string[] = [];
  if (s.return_visitor) out.push(`Came back: ${s.unique_sessions} separate sessions on the memo.`);
  if (s.prints > 0) out.push(`Printed the memo ${s.prints} time(s). They are saving it.`);
  if (s.copies > 0) out.push(`Copied text out of the memo ${s.copies} time(s). Probably sharing internally.`);
  if (s.cta_clicks > 0) out.push(`Clicked the book-a-call CTA ${s.cta_clicks} time(s).`);
  if (s.scroll_100s > 0) out.push(`Scrolled to the very bottom ${s.scroll_100s} time(s). Full read.`);
  if (s.verdict_expansions > 0) out.push(`Expanded ${s.verdict_expansions} verdict cell(s). They wanted to know what we think.`);
  if (s.total_dwell_seconds >= 60) {
    out.push(`Spent ${Math.round(s.total_dwell_seconds / 60)} minutes total on the memo.`);
  } else if (s.total_dwell_seconds >= 15) {
    out.push(`Spent ${s.total_dwell_seconds}s on the memo.`);
  }
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

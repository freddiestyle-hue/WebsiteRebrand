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
    subject = humanize(parsed.subject);
    body = humanize(parsed.body);
    // Belt-and-braces: ensure the cal link is in the body. The model is
    // told to include it; if it forgets, append a soft tail rather than
    // ship a draft without an ask.
    if (body && !body.includes(CAL_URL)) {
      body = body.replace(/\s*$/, '') + `\n\n${CAL_URL}`;
    }
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

== HUMANIZE RULES (the most-broken ones, listed first because the model keeps breaking them) ==

ABSOLUTE: NO EM DASHES. The em dash character (—, U+2014) is BANNED. The double-hyphen "--" is BANNED. Use a comma, a period, parentheses, or just break into two sentences. Every time you reach for an em dash, you have failed. There is no exception, including "natural rhythm" arguments. If your draft contains "—" or "--" anywhere, rewrite it.

NO emoji. Not one.

NO rule-of-three. No three-item lists. No three short sentences in a row. No "X, Y, and Z" trios.

== SHAPE ==
- LinkedIn DM body: 240-380 characters (slightly longer now to fit the cal link). Email body: 60-120 words.
- 2-4 sentences max. No paragraphs.
- ONE line acknowledging what they did (came back, scrolled, expanded). Specific, not generic.
- ONE line pointing at the gap-they-care-about GENERICALLY (NOT a recap). "The tracking gap" / "the page-speed thing" / "the conversion side." A pointer, not a re-read.
- ONE direct ask + the call link. End with the cal URL inline, not on its own line. Example: "20 min this week? https://cal.com/fred-style/discovery"
- (Optional) Reference the memo URL when it lands naturally. Example: "the audit's still up at https://rivett.tech/audit/v3/<slug> if you want to flick back."

== HARD BANS (non-negotiable; the message reads as AI-generated if you break these) ==

Banned VERBS (use plain): leverage, utilize, delve, craft, garner, elevate, amplify, spearhead, streamline, curate, harness, cultivate, navigate (when figurative), facilitate, embark, empower, bolster, foster, augment, maximize, underscore, catalyze, reimagine, resonate, revolutionize, showcase, unpack, demystify.

Banned ADJECTIVES (never): groundbreaking, cutting-edge, innovative, robust, seamless, scalable, transformative, unprecedented, dynamic, holistic, comprehensive, compelling, remarkable, pivotal, crucial, meticulous, multifaceted, profound, vibrant, vital, adept, commendable, exemplary, game-changing, invaluable, noteworthy, paramount, state-of-the-art, streamlined, tailored, thought-provoking.

Banned ADVERBS (never): drastically, genuinely, remarkably, significantly, strategically, substantially, profoundly, meticulously, notably, truly.

Banned PHRASES (delete on sight): "a testament to", "it's important to note", "at its core", "in today's landscape", "moving forward", "that said", "when it comes to", "here's the thing", "make no mistake", "simply put", "the reality is", "let me know if interested", "let's break this down", "let's dive in", "this highlights", "this underscores", "the key takeaway", "let that sink in", "spoiler alert", "hot take", "pro tip", "level up", "move the needle", "low-hanging fruit", "circle back", "hope you're well", "just wanted to", "I wanted to reach out".

Banned PATTERNS:
- Em dashes (--). Use commas, periods, or parentheses.
- Emoji. None. Not even one.
- Rule of three. No "A, B, and C" trios. No three-bullet stacks. No three-sentence rhythms.
- Contrast framing: NEVER "It's not X, it's Y" / "This isn't about X, it's about Y" / "Not just X, but Y". Just say what it is.
- Self-narration: "Here's why this matters", "The kicker?", "But here's the thing". If the point needs a sign, the point is weak.
- "Nobody tells you this" / "What nobody realizes" framing.
- Fake naming: invented capitalised concepts like "The Growth Paradox" or "The 5-Step Framework".
- Transition openers: However, Moreover, Furthermore, Additionally, Nevertheless, Notably, Indeed, Consequently, Accordingly, Fundamentally, Essentially. Use "but", "also", or no transition.
- Significance inflation: "marking a pivotal moment", "setting the stage for", "a testament to".
- -ing phrase padding: "highlighting the importance of", "underscoring the need for", "paving the way for", "reflecting a broader trend".
- Copula avoidance: "serves as", "stands as", "functions as", "represents", "boasts", "features", "offers". Just use "is" or "has".
- Dramatic short-sentence stacks: "They tried. They failed. They learned." Banned.
- No numbers, percentages, or product names from the audit. The prospect already saw those.
- Links ARE allowed (cal.com + audit URL) but only the two URLs you are given. No other URLs.

== VOICE ==
- Normal sentence capitalisation. Capitalise the first letter of each sentence, the prospect's first name, proper nouns. Don't write in all-lowercase. ("Heidi, you came back twice" not "heidi, you came back twice".)
- Operator-to-operator tone: direct, concrete, slightly sharp, never corporate.
- Vary sentence rhythm. Don't stack three short sentences in a row. Don't stack three long ones either.
- Specificity over abstraction. "Tracking is broken" beats "there's an opportunity to optimize".
- Have an opinion. "I'd start there" beats "this might warrant exploration".
- Leave some texture. A half-thought, an aside, a "honestly", these read human. Perfect structure reads algorithmic.

== EXAMPLES (right shape, with the cal link inline, normal capitalisation) ==

"Heidi, you came back twice. Probably means the tracking gap is the one worth talking through first. 20 min this week? https://cal.com/fred-style/discovery"

"Claire, you went all the way to the bottom and expanded the verdicts. Quickest path is a walk-through of the fix order. The audit's at https://rivett.tech/audit/v3/beaphar-co-uk if you want to flick back. Grab 15 min: https://cal.com/fred-style/discovery"

"Frank, opened it twice but didn't scroll much. Happy to do 10 min where I just hit the headline findings, then we can pick which one matters. https://cal.com/fred-style/discovery"

== OUTPUT ==
Strictly JSON: {"subject": "...", "body": "..."}
- LinkedIn: subject is "". Body 240-380 chars including the cal URL.
- Email: subject is 4-6 words, sentence case (capitalise first word only, lowercase the rest unless proper noun), no punctuation at end. Body 60-120 words including the cal URL.
- Return ONLY the JSON. No preamble, no markdown fences.
- The body MUST include https://cal.com/fred-style/discovery exactly once.
- The body MAY include the audit URL if it lands naturally (do not force it).`;

const CAL_URL = 'https://cal.com/fred-style/discovery';

function buildPrompt(
  prospect: ProspectInfo,
  signals: DraftSignals,
  channel: Channel
): string {
  const lines: string[] = [];
  lines.push(`Channel: ${channel}`);
  lines.push('');
  lines.push('LINKS YOU MUST USE');
  lines.push(`- Cal link (REQUIRED, include verbatim in the body): ${CAL_URL}`);
  lines.push(`- Audit URL (OPTIONAL, include if it lands naturally): https://rivett.tech/audit/v3/${prospect.slug}`);
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

/**
 * Last-line defence against the worst AI-tells. The system prompt bans em
 * dashes loudly but the model still emits them sometimes. Strip them here
 * and replace with a comma + space so the rhythm survives.
 */
function humanize(text: string): string {
  if (!text) return text;
  return text
    // U+2014 em dash, U+2013 en dash (used figuratively)
    .replace(/\s*[—–]\s*/g, ', ')
    // Double-hyphen as em-dash stand-in
    .replace(/\s+--\s+/g, ', ')
    // Common AI openers, silently strip
    .replace(/^\s*(Hope you('re| are) well[.,]?\s*|I hope this finds you well[.,]?\s*|Just wanted to (reach out|follow up)[.,]?\s*)/i, '')
    .trim();
}

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

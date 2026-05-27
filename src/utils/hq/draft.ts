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
  // v2: prompt rewrite that pulls specific findings instead of generic
  // category hints. Bump invalidates stale templated drafts from v1.
  const cacheKey = `hq:draft:v2:${prospect.slug}:${channel}`;
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
      temperature: 1.0,
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

== THE #1 RULE: SPECIFICITY ==

Every draft you write must reference ONE concrete thing from the audit findings by name. Not a category ("the tracking gap"). Not a vibe ("the conversion side"). A specific NAMED thing the prospect would recognize: "the GA4 double-fire on /checkout", "the 4.2s LCP on mobile", "the missing schema on your service pages", "the form that takes 8 seconds to load".

If the audit findings block is empty or thin, then reference one specific thing about THEM (their role, their company's positioning, their industry) and admit the audit was at the higher level. Don't fabricate findings.

Two messages should NEVER read like the same template with the name swapped. If you find yourself reaching for a generic phrase ("the tracking side", "the conversion piece"), STOP and pull a specific name out of the audit findings.

== HUMANIZE RULES (the most-broken ones, listed first because the model keeps breaking them) ==

ABSOLUTE: NO EM DASHES. The em dash character (—, U+2014) is BANNED. The double-hyphen "--" is BANNED. Use a comma, a period, parentheses, or just break into two sentences. If your draft contains "—" or "--" anywhere, rewrite it.

NO emoji. Not one.

NO rule-of-three. No three-item lists. No three short sentences in a row. No "X, Y, and Z" trios.

== SHAPE (guidance, not a template - VARY this) ==

- LinkedIn DM body: 240-380 characters total (including the cal URL). Email body: 60-120 words.
- 2-4 sentences. No paragraphs.
- Must include the cal URL inline (never on its own line, never as the only content of a sentence).
- May reference the memo URL if it lands naturally.

Beyond that: vary your structure. Sometimes lead with the audit finding. Sometimes lead with what they did. Sometimes lead with a one-line opinion. Sometimes the ask is a question, sometimes it's a soft offer ("happy to do 15 min"), sometimes it's "grab 15 min: <link>". DO NOT default to the same 3-line skeleton ("name + action. gap pointer. ask + link.") for every prospect.

== HARD BANS (non-negotiable; the message reads as AI-generated if you break these) ==

Banned VERBS (use plain): leverage, utilize, delve, craft, garner, elevate, amplify, spearhead, streamline, curate, harness, cultivate, navigate (when figurative), facilitate, embark, empower, bolster, foster, augment, maximize, underscore, catalyze, reimagine, resonate, revolutionize, showcase, unpack, demystify.

Banned ADJECTIVES (never): groundbreaking, cutting-edge, innovative, robust, seamless, scalable, transformative, unprecedented, dynamic, holistic, comprehensive, compelling, remarkable, pivotal, crucial, meticulous, multifaceted, profound, vibrant, vital, adept, commendable, exemplary, game-changing, invaluable, noteworthy, paramount, state-of-the-art, streamlined, tailored, thought-provoking.

Banned ADVERBS (never): drastically, genuinely, remarkably, significantly, strategically, substantially, profoundly, meticulously, notably, truly.

Banned PHRASES (delete on sight): "a testament to", "it's important to note", "at its core", "in today's landscape", "moving forward", "that said", "when it comes to", "here's the thing", "make no mistake", "simply put", "the reality is", "let me know if interested", "let's break this down", "let's dive in", "this highlights", "this underscores", "the key takeaway", "let that sink in", "spoiler alert", "hot take", "pro tip", "level up", "move the needle", "low-hanging fruit", "circle back", "hope you're well", "just wanted to", "I wanted to reach out", "you went all the way to the bottom" (overused), "the tracking side is honestly where I'd start" (overused), "tends to be the thing that makes the rest of" (overused), "worth 20 minutes" (overused phrasing - vary it).

Banned PATTERNS:
- Em dashes (--). Use commas, periods, or parentheses.
- Emoji. None.
- Rule of three. No "A, B, and C" trios. No three-bullet stacks. No three-sentence rhythms.
- Contrast framing: NEVER "It's not X, it's Y" / "This isn't about X, it's about Y" / "Not just X, but Y".
- Self-narration: "Here's why this matters", "The kicker?", "But here's the thing".
- "Nobody tells you this" / "What nobody realizes" framing.
- Fake naming: invented capitalised concepts like "The Growth Paradox" or "The 5-Step Framework".
- Transition openers: However, Moreover, Furthermore, Additionally, Nevertheless, Notably, Indeed, Consequently, Accordingly, Fundamentally, Essentially.
- Significance inflation: "marking a pivotal moment", "setting the stage for".
- -ing phrase padding: "highlighting the importance of", "underscoring the need for".
- Copula avoidance: "serves as", "stands as", "functions as", "represents", "boasts", "features", "offers". Just use "is" or "has".
- Dramatic short-sentence stacks: "They tried. They failed. They learned." Banned.
- Numbers, percentages from the audit ARE allowed when they're the specific thing you're naming (e.g. "the 4.2s LCP"). Otherwise no stats dump.
- Links: only the two you're given (cal.com + audit URL). No other URLs.

== VOICE ==

- Normal sentence capitalisation. Don't write in all-lowercase.
- Operator-to-operator tone: direct, concrete, slightly sharp, never corporate.
- Vary sentence rhythm.
- Specificity over abstraction. "GA4 isn't firing on the booking page" beats "tracking has gaps".
- Have an opinion. "I'd fix that first" beats "this might warrant exploration".
- Leave texture. A half-thought, an aside, a "honestly", these read human. Perfect structure reads algorithmic.

== EXAMPLES (note: each has a DIFFERENT shape - do not just swap names into one of these) ==

Example 1 (lead with the specific finding, dwell signal is secondary):
"James, the GA4 double-fire on /checkout is the one I'd want to walk through, especially given how Fresha's pricing pages flow. Came back to the audit twice, so I think you already see it. 15 min: https://cal.com/fred-style/discovery"

Example 2 (lead with an opinion, then the audit anchor):
"Honestly, Frank, missing schema on your service pages is the cheapest win in the whole audit and you read past it. Happy to map the fix in 15 min, https://cal.com/fred-style/discovery"

Example 3 (lead with the prospect's situation, soft ask, no question):
"Nikisa, Accent Inns running paid traffic without conversion tracking is the thing I'd unblock before anything else. The audit's at https://rivett.tech/audit/v3/accentinns-com if you want the receipts. Grab a 15 here: https://cal.com/fred-style/discovery"

Notice: different opening word, different sentence count, different ask pattern, different placement of the cal link.

== OUTPUT ==
Strictly JSON: {"subject": "...", "body": "..."}
- LinkedIn: subject is "". Body 240-380 chars including the cal URL.
- Email: subject is 4-6 words, sentence case, no punctuation at end. Body 60-120 words including the cal URL.
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

  // Pass the actual audit findings verbatim. Truncate to ~600 chars to keep
  // token costs predictable; the LLM should pull ONE specific named thing.
  if (prospect.auditContext && prospect.auditContext.trim()) {
    const ctx = prospect.auditContext.trim();
    const truncated = ctx.length > 600 ? ctx.slice(0, 600) + '...' : ctx;
    lines.push('AUDIT FINDINGS (pull ONE specific concrete thing from here and reference it by name)');
    lines.push(truncated);
    lines.push('');
  } else {
    lines.push('AUDIT FINDINGS: (none in Airtable yet - reference the prospect\'s role/company specifically instead, and keep the message higher-level)');
    lines.push('');
  }

  // Pass raw signal counts. Let the LLM phrase them so different prospects
  // don't get the same pre-baked sentence ("you went all the way to the
  // bottom" was appearing in 80%+ of drafts).
  lines.push('ENGAGEMENT SIGNALS (use sparingly, max one reference, vary the phrasing)');
  lines.push(`- Total dwell: ${signals.total_dwell_seconds}s`);
  lines.push(`- Sessions: ${signals.unique_sessions}`);
  lines.push(`- Views: ${signals.total_views}`);
  lines.push(`- Return visitor: ${signals.return_visitor ? 'yes' : 'no'}`);
  lines.push(`- Reached bottom of memo: ${signals.scroll_100s > 0 ? 'yes' : 'no'}`);
  lines.push(`- Verdict cells expanded: ${signals.verdict_expansions}`);
  lines.push(`- Copies: ${signals.copies}, Prints: ${signals.prints}, CTA clicks: ${signals.cta_clicks}`);
  lines.push('');

  lines.push(
    channel === 'linkedin'
      ? 'Write a LinkedIn DM. 240-380 chars including the cal URL. 2-4 sentences. Reference ONE specific finding from the audit by name. Vary the structure - do not default to "name + behaviour. category. ask."'
      : 'Write an email. Subject 4-6 words, sentence case. Body 60-120 words including the cal URL. 2-4 sentences. Reference ONE specific finding from the audit by name. Vary the structure.'
  );

  return lines.join('\n');
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

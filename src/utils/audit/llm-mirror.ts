// Mirror Audit: ask Claude what AI engines would understand a site to be,
// then juxtapose that with what the site itself claims to be. The gap IS
// the diagnosis.
//
// Cost target: ~$0.005 per audit using Claude Haiku 4.5.
// Fails open: if no API key or call errors, returns null and the memo
// proceeds without the Mirror section.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_HTML_BYTES = 32_000;
const TIMEOUT_MS = 15_000;

export interface MirrorResult {
  aiPerception: string;
  ownClaim: string;
  gap: string;
  ranAt: string;
  durationMs: number;
}

interface MirrorInputs {
  url: string;
  hostname: string;
  html: string;
}

function isApiKeyAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 10;
}

function extractReadableText(html: string): string {
  // Drop scripts and styles first; they're noise and they're long.
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Preserve <title>, <meta name="description">, og:* for AI engine signal
  const titleMatch = s.match(/<title>([\s\S]*?)<\/title>/i);
  const descMatch = s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || s.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const ogTitle = s.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc = s.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const h1 = s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);

  const headers: string[] = [];
  if (titleMatch) headers.push(`<title>: ${titleMatch[1].trim()}`);
  if (descMatch) headers.push(`<meta description>: ${descMatch[1].trim()}`);
  if (ogTitle) headers.push(`og:title: ${ogTitle[1].trim()}`);
  if (ogDesc) headers.push(`og:description: ${ogDesc[1].trim()}`);
  if (h1) headers.push(`<h1>: ${h1[1].replace(/<[^>]+>/g, ' ').trim()}`);

  // Strip remaining tags, collapse whitespace
  let body = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (body.length > MAX_HTML_BYTES - 1500) body = body.slice(0, MAX_HTML_BYTES - 1500);

  return `${headers.join('\n')}\n\n--- BODY TEXT ---\n${body}`;
}

const SYSTEM_PROMPT = `You are a senior growth diagnostician. You read websites the way an AI search engine does and you write the way Rivett writes — direct, concrete, no marketer vocabulary. Operator voice. No em-dashes. No "leverage", "unlock", "empower", "10x", "journey", "solution", "synergy", "seamless".

Output JSON only. Three fields, each one short paragraph (2-4 sentences). No filler.

{
  "aiPerception": "What an AI engine would understand this business to be from the page provided. Be specific. Name what they sell, who they sell to, what they appear to be the authority on. If the page is unclear, say so concretely (do not hedge).",
  "ownClaim": "What the site explicitly claims about itself in title/description/H1. Quote the actual words where useful. This is what the operator thinks they're communicating.",
  "gap": "Where AI perception and own claim diverge. If they match cleanly, say so. If they don't, name the specific gap an AI engine would carry forward when citing this site. End with the one concrete change that would close the gap."
}

Italic-clause rule: write naturally; voice normalisation happens downstream. Just be specific and operator-voiced.`;

export async function mirrorAudit(inputs: MirrorInputs): Promise<MirrorResult | null> {
  if (!isApiKeyAvailable()) return null;
  const startedAt = Date.now();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userContent = `Site: ${inputs.url} (hostname: ${inputs.hostname})

Below is the readable text of the homepage. Read it the way an AI engine would, then output the JSON described in the system prompt.

${extractReadableText(inputs.html)}`;

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let raw: string;
    try {
      const res = await client.messages.create(
        {
          model: MODEL,
          max_tokens: 800,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        },
        { signal: controller.signal },
      );
      const block = res.content.find((b) => b.type === 'text');
      raw = block && block.type === 'text' ? block.text : '';
    } finally {
      clearTimeout(t);
    }
    if (!raw) return null;
    const parsed = parseJsonFromText(raw);
    if (!parsed) return null;
    if (typeof parsed.aiPerception !== 'string' || typeof parsed.ownClaim !== 'string' || typeof parsed.gap !== 'string') {
      return null;
    }
    return {
      aiPerception: normalizeVoice(parsed.aiPerception),
      ownClaim: normalizeVoice(parsed.ownClaim),
      gap: normalizeVoice(parsed.gap),
      ranAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mirror-audit] failed: ${msg}`);
    return null;
  }
}

function parseJsonFromText(text: string): { aiPerception?: string; ownClaim?: string; gap?: string } | null {
  // Try direct parse first
  try { return JSON.parse(text); } catch {}
  // Find first { and last } and try the slice
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
}

// Strip the few worst Claude-isms in case Haiku slipped one through.
function normalizeVoice(s: string): string {
  return s
    .replace(/—/g, ', ')
    .replace(/–/g, '-')
    .replace(/\bleverages?\b/gi, 'uses')
    .replace(/\bleveraging\b/gi, 'using')
    .replace(/\bunlocks?\b/gi, 'enables')
    .replace(/\bunlocking\b/gi, 'enabling')
    .replace(/\bempowers?\b/gi, 'lets')
    .replace(/\bempowering\b/gi, 'letting')
    .replace(/\b10x\b/gi, 'much more')
    .replace(/\bjourney\b/gi, 'process')
    .replace(/\bsolutions?\b/gi, 'tools')
    .replace(/\bsynergy\b/gi, 'fit')
    .replace(/\bseamless(ly)?\b/gi, 'smooth$1')
    .trim();
}

// Hero eval suite. The checks a generated hero must pass before it ships to a
// prospect: grounding (every number traces to the audit), anti-AI-tell (the
// voice rules HERO_SYSTEM_PROMPT sets), and shape (the output contract).
//
// Runs as the gate before the bulk regeneration: a hero that fails any check
// should fall back to the rule-based pickHeroFinding rather than reach a
// prospect with a hallucinated number or an obvious AI tell.

import type { HeroResult } from './hero-llm';
import { checkHeroGrounding } from './hero-grounding';

// Banned words - mirrors the "Banned words" line in HERO_SYSTEM_PROMPT. Each
// pattern is anchored so it catches the word and its common inflections
// without false-positiving on unrelated words: "landscaping" (the trade) is
// deliberately not caught, only the metaphorical "landscape" / "landscapes".
const BANNED_PATTERNS: ReadonlyArray<{ word: string; re: RegExp }> = [
  { word: 'delve', re: /\bdelv(e|es|ed|ing)\b/i },
  { word: 'robust', re: /\brobust(ly|ness)?\b/i },
  { word: 'leverage', re: /\bleverag(e|es|ed|ing)\b/i },
  { word: 'unlock', re: /\bunlock(s|ed|ing)?\b/i },
  { word: 'seamless', re: /\bseamless(ly)?\b/i },
  { word: 'crucial', re: /\bcrucial(ly)?\b/i },
  { word: 'landscape', re: /\blandscapes?\b/i },
];

export const BANNED_WORDS: ReadonlyArray<string> = BANNED_PATTERNS.map((p) => p.word);

// The DM one-liner has to fit a cold LinkedIn message.
const DM_ONE_LINER_MAX_WORDS = 30;

// Split text into sentences on ., !, ? followed by whitespace or end of text.
// The trailing lookahead keeps a decimal point inside a number ("2.5s",
// "12.9s") from reading as a sentence boundary - without it a one-liner
// ending "...threshold is 2.5s." splits off a stray one-word "5s".
function sentences(text: string): string[] {
  return text
    .split(/[.!?]+(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export interface AntiTellResult {
  clean: boolean;
  tells: string[];
}

// Flag the AI tells HERO_SYSTEM_PROMPT bans: banned words, em/en dashes,
// one-word "dramatic" sentences, and a three-short-sentence rule-of-three
// cadence ("It is fast. It is clean. It is gone.").
export function checkAntiAiTell(text: string): AntiTellResult {
  const tells: string[] = [];

  for (const { word, re } of BANNED_PATTERNS) {
    if (re.test(text)) tells.push(`banned word: ${word}`);
  }

  if (/[—–]/.test(text)) tells.push('em or en dash');

  const sents = sentences(text);
  for (const s of sents) {
    if (wordCount(s) === 1) tells.push(`one-word sentence: "${s}"`);
  }

  // Rule-of-three: three or more consecutive very short sentences in a row.
  let run = 0;
  for (const s of sents) {
    run = wordCount(s) <= 4 ? run + 1 : 0;
    if (run >= 3) {
      tells.push('rule-of-three cadence');
      break;
    }
  }

  return { clean: tells.length === 0, tells };
}

export interface ShapeResult {
  ok: boolean;
  issues: string[];
}

// The output contract: three non-empty fields, and a DM one-liner under 30
// words.
export function checkHeroShape(hero: HeroResult): ShapeResult {
  const issues: string[] = [];
  if (!hero.pageHero?.trim()) issues.push('pageHero is empty');
  if (!hero.dmOneLiner?.trim()) issues.push('dmOneLiner is empty');
  if (!hero.strength?.trim()) issues.push('strength is empty');

  const dmWords = wordCount(hero.dmOneLiner ?? '');
  if (dmWords >= DM_ONE_LINER_MAX_WORDS) {
    issues.push(`dmOneLiner is ${dmWords} words (must be under ${DM_ONE_LINER_MAX_WORDS})`);
  }

  return { ok: issues.length === 0, issues };
}

export interface HeroEvalResult {
  pass: boolean;
  failures: string[];
}

// Run the full gate on one hero. auditCorpus is the user-prompt text the hero
// was generated from - grounding checks every number it states against it.
export function evaluateHero(hero: HeroResult, auditCorpus: string): HeroEvalResult {
  const failures: string[] = [];

  const grounding = checkHeroGrounding(hero, auditCorpus);
  if (!grounding.grounded) {
    failures.push(`ungrounded numbers: ${grounding.ungroundedNumbers.join(', ')}`);
  }

  for (const issue of checkHeroShape(hero).issues) {
    failures.push(`shape: ${issue}`);
  }

  for (const [field, text] of [
    ['pageHero', hero.pageHero],
    ['dmOneLiner', hero.dmOneLiner],
    ['strength', hero.strength],
  ] as const) {
    for (const tell of checkAntiAiTell(text ?? '').tells) {
      failures.push(`${field}: ${tell}`);
    }
  }

  return { pass: failures.length === 0, failures };
}

// Grounding check for the LLM hero. The hero is allowed to state only numbers
// that appear in the audit it was given. A number the audit never mentioned
// is a hallucination, or an artifact of a prompt-injection attempt by the
// scraped prospect site - either way the hero is rejected and the caller
// falls back to the rule-based pickHeroFinding.
//
// Scope: digit numbers. Spelled-out numbers ("four seconds") are not checked -
// the precise, checkable, dangerous claims are written in digits.

import type { HeroResult } from './hero-llm';

export interface GroundingResult {
  grounded: boolean;
  ungroundedNumbers: string[];
}

// Pull every numeric token: a digit run with optional thousands commas and an
// optional decimal. Commas are stripped so "2,400" and "2400" compare equal.
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].replace(/,/g, ''));
  }
  return out;
}

// The hero is grounded when every number it states also appears in the audit
// corpus it was given (the user-prompt text). Returns the offending numbers
// when it is not.
export function checkHeroGrounding(hero: HeroResult, auditCorpus: string): GroundingResult {
  const corpus = new Set(extractNumbers(auditCorpus));
  const heroText = [hero.pageHero, hero.dmOneLiner, hero.strength].join(' ');
  const ungrounded = [...new Set(extractNumbers(heroText))].filter((n) => !corpus.has(n));
  return { grounded: ungrounded.length === 0, ungroundedNumbers: ungrounded };
}

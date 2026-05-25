// Grounding check for the LLM hero. The hero is allowed to state only numbers
// that appear in the audit it was given, and may only name an ad platform
// (Meta/Facebook/LinkedIn) when the audit actually published a count for it.
// Anything else is a hallucination, or an artifact of a prompt-injection
// attempt by the scraped prospect site - either way the hero is rejected and
// the caller falls back to the rule-based pickHeroFinding.
//
// Scope: digit numbers. Spelled-out numbers ("four seconds") are not checked -
// the precise, checkable, dangerous claims are written in digits.

import type { HeroResult } from './hero-llm';

export interface GroundingResult {
  grounded: boolean;
  ungroundedNumbers: string[];
  ungroundedPlatforms: string[];
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

// Platforms whose ad counts the audit may or may not publish on any given run.
// ads-check.ts withholds Meta/LinkedIn counts (null) until those lookups can be
// keyed off a verified advertiser identity, so the v3-synth "Ad Library:" line
// is the canonical ground-truth marker that a platform's ad activity is real.
const AD_PLATFORMS = ['Meta', 'Facebook', 'LinkedIn', 'Google'] as const;
type AdPlatform = (typeof AD_PLATFORMS)[number];

// Patterns that constitute an ad claim about a specific platform: "N Meta ads",
// "active Meta", "Meta ad", "across Meta", "on Meta", "Meta and Google", etc.
// Matches "Meta Pixel" / "LinkedIn Insight" are intentionally excluded - those
// are tracking-tag claims, which the audit measures independently from ad
// activity. The grounding rule fires only on language that asserts spend.
function platformAdClaims(text: string): AdPlatform[] {
  const hit = new Set<AdPlatform>();
  for (const p of AD_PLATFORMS) {
    const adRe = new RegExp(
      `\\b\\d+\\s+(?:active\\s+)?${p}\\b|\\bactive\\s+${p}\\b|\\b${p}\\s+ads?\\b|\\b(?:across|on)\\s+${p}\\b|\\b${p}\\s+and\\s+(?:Google|Meta|Facebook|LinkedIn)\\b|\\b(?:Google|Meta|Facebook|LinkedIn)\\s+and\\s+${p}\\b|\\b${p}\\s*,\\s*(?:Google|Meta|Facebook|LinkedIn)\\b`,
      'i',
    );
    if (adRe.test(text)) hit.add(p);
  }
  return [...hit];
}

// The audit corpus shows a platform's ad count via the canonical v3-synth
// line, "Meta Ad Library: N active", or via a JSON field like
// `"metaActive": <number>` when the memo is serialised. A null/absent field
// is not evidence.
function corpusPublishedAdCountFor(platform: AdPlatform, corpus: string): boolean {
  // v3-synth writes "Meta Ad Library: N" but "Google Ads Library: N" (with an
  // s on Ads). Accept either spelling so the check is robust to that quirk.
  const adLibraryRe = new RegExp(`\\b${platform}\\s+Ads?\\s+Library:\\s*\\d`, 'i');
  if (adLibraryRe.test(corpus)) return true;
  const jsonKeyRe = new RegExp(`"${platform.toLowerCase()}Active"\\s*:\\s*\\d`, 'i');
  return jsonKeyRe.test(corpus);
}

// The hero is grounded when every number it states appears in the audit
// corpus, AND every ad-platform claim is backed by a published count for that
// platform. Returns the offending numbers and platforms when it is not.
export function checkHeroGrounding(hero: HeroResult, auditCorpus: string): GroundingResult {
  const corpusNums = new Set(extractNumbers(auditCorpus));
  const heroText = [hero.pageHero, hero.dmOneLiner, hero.strength].join(' ');

  const ungroundedNumbers = [...new Set(extractNumbers(heroText))].filter(
    (n) => !corpusNums.has(n),
  );

  const ungroundedPlatforms = platformAdClaims(heroText).filter(
    (p) => !corpusPublishedAdCountFor(p, auditCorpus),
  );

  return {
    grounded: ungroundedNumbers.length === 0 && ungroundedPlatforms.length === 0,
    ungroundedNumbers,
    ungroundedPlatforms,
  };
}

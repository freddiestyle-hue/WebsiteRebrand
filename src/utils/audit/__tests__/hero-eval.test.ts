import { describe, it, expect } from 'vitest';
import { checkAntiAiTell, checkHeroShape, evaluateHero, BANNED_WORDS } from '../hero-eval';
import { HERO_SYSTEM_PROMPT } from '../hero-llm';
import type { HeroResult } from '../hero-llm';

// A clean, grounded, on-voice hero. Numbers: only "4.6", which the test corpus
// carries. strength deliberately has no digits (extractNumbers would catch the
// "4" in a token like "GA4").
function hero(over: Partial<HeroResult> = {}): HeroResult {
  return {
    pageHero:
      'Your homepage takes 4.6 seconds to load on mobile, so paid clicks bounce before the offer renders.',
    dmOneLiner:
      'Quick one, Robert - the homepage takes 4.6s on mobile and most paid clicks leave first.',
    strength: 'Your tracking is genuinely well wired, with analytics and conversion pixels both live.',
    ...over,
  };
}

describe('checkAntiAiTell', () => {
  it('passes clean operator-voice prose', () => {
    expect(checkAntiAiTell('Your homepage is slow and paid clicks bounce.').clean).toBe(true);
  });

  it('flags banned words', () => {
    const r = checkAntiAiTell('We leverage a robust, seamless platform.');
    expect(r.clean).toBe(false);
    expect(r.tells).toEqual(
      expect.arrayContaining(['banned word: leverage', 'banned word: robust', 'banned word: seamless']),
    );
  });

  it('flags an em dash', () => {
    expect(checkAntiAiTell('Fast site — slow funnel.').tells).toContain('em or en dash');
  });

  it('flags a one-word dramatic sentence', () => {
    const r = checkAntiAiTell('Your funnel leaks before the form. Badly.');
    expect(r.tells.some((t) => t.startsWith('one-word sentence'))).toBe(true);
  });

  it('flags a rule-of-three staccato cadence', () => {
    expect(checkAntiAiTell('It is fast. It is clean. It is gone.').tells).toContain(
      'rule-of-three cadence',
    );
  });

  it('does not flag "landscaping" the trade, only metaphorical "landscape"', () => {
    expect(checkAntiAiTell('You run a landscaping business.').clean).toBe(true);
    expect(checkAntiAiTell('The competitive landscape shifted under you.').clean).toBe(false);
  });
});

describe('checkHeroShape', () => {
  it('accepts a well-formed hero', () => {
    expect(checkHeroShape(hero()).ok).toBe(true);
  });

  it('rejects a DM one-liner of 30 words or more', () => {
    const long = Array.from({ length: 32 }, (_, i) => `word${i}`).join(' ');
    const r = checkHeroShape(hero({ dmOneLiner: long }));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('words'))).toBe(true);
  });

  it('rejects an empty field', () => {
    expect(checkHeroShape(hero({ strength: '' })).ok).toBe(false);
  });
});

describe('evaluateHero', () => {
  const corpus = 'AUDIT_JSON: { "lcp": "4.6s", "score": "34 / 100" }';

  it('passes a clean, grounded, on-voice hero', () => {
    const r = evaluateHero(hero(), corpus);
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails a hero that states an ungrounded number', () => {
    const r = evaluateHero(
      hero({ dmOneLiner: 'You are losing 9000 visitors a month to load time.' }),
      corpus,
    );
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.includes('ungrounded'))).toBe(true);
  });

  it('fails a hero carrying a banned word, naming the field', () => {
    const r = evaluateHero(hero({ pageHero: 'You can unlock more revenue here.' }), corpus);
    expect(r.pass).toBe(false);
    expect(r.failures).toContain('pageHero: banned word: unlock');
  });
});

describe('BANNED_WORDS', () => {
  it('every banned word is named in the hero system prompt', () => {
    const prompt = HERO_SYSTEM_PROMPT.toLowerCase();
    for (const w of BANNED_WORDS) {
      expect(prompt).toContain(w);
    }
  });
});

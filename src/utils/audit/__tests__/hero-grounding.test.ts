import { describe, it, expect } from 'vitest';
import { extractNumbers, checkHeroGrounding } from '../hero-grounding';
import type { HeroResult } from '../hero-llm';

function hero(over: Partial<HeroResult> = {}): HeroResult {
  return { pageHero: 'A.', dmOneLiner: 'B.', strength: 'C.', ...over };
}

describe('extractNumbers', () => {
  it('pulls digit runs, decimals, and ratio numbers', () => {
    expect(extractNumbers('LCP 4.6s, score 57 / 100')).toEqual(['4.6', '57', '100']);
  });

  it('strips thousands commas and ignores currency symbols', () => {
    expect(extractNumbers('worth about $2,400 a month')).toEqual(['2400']);
  });

  it('returns nothing for number-free text', () => {
    expect(extractNumbers('a clean, fast homepage')).toEqual([]);
  });
});

describe('checkHeroGrounding', () => {
  const corpus = 'AUDIT_JSON: { "lcp": "4.6s", "score": "57 / 100", "ads": 3 }';

  it('passes a hero whose every number is in the audit', () => {
    const r = checkHeroGrounding(
      hero({ pageHero: 'Your homepage takes 4.6 seconds and scores 57.' }),
      corpus,
    );
    expect(r.grounded).toBe(true);
    expect(r.ungroundedNumbers).toEqual([]);
  });

  it('rejects a hero that states a number absent from the audit', () => {
    const r = checkHeroGrounding(hero({ dmOneLiner: 'You are losing $9000 a month.' }), corpus);
    expect(r.grounded).toBe(false);
    expect(r.ungroundedNumbers).toContain('9000');
  });

  it('passes a hero with no numbers at all', () => {
    const r = checkHeroGrounding(hero({ pageHero: 'Your funnel leaks before the form.' }), corpus);
    expect(r.grounded).toBe(true);
  });
});

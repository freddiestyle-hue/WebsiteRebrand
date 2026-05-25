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

describe('checkHeroGrounding — ad-platform claims', () => {
  // Canonical post-fix corpus: only Google has a published count. Meta and
  // LinkedIn are present as tracking-pixel detections, never as ad counts.
  const googleOnlyCorpus = `AUDIT_JSON: {
    "dimensions": [
      { "dimension": "Tracking", "reading": "Meta Pixel firing, LinkedIn Insight Tag firing" }
    ],
    "ads_note": "Google Ads Library: 7 active creatives"
  }`;

  it('rejects "Meta ad" when the audit only published a Google count', () => {
    const r = checkHeroGrounding(
      hero({ dmOneLiner: 'Your one active Meta ad lands on a slow page.' }),
      googleOnlyCorpus,
    );
    expect(r.grounded).toBe(false);
    expect(r.ungroundedPlatforms).toContain('Meta');
  });

  it('rejects "LinkedIn ads" when the audit only published a Google count', () => {
    const r = checkHeroGrounding(
      hero({ pageHero: 'You are running 7 active LinkedIn ads to a 7.4s page.' }),
      googleOnlyCorpus,
    );
    expect(r.grounded).toBe(false);
    expect(r.ungroundedPlatforms).toContain('LinkedIn');
  });

  it('rejects "across Meta and Google" framing without a Meta count', () => {
    const r = checkHeroGrounding(
      hero({ pageHero: 'Spending 70 active ads across Meta and Google.' }),
      googleOnlyCorpus.replace('7 active', '70 active'),
    );
    expect(r.grounded).toBe(false);
    expect(r.ungroundedPlatforms).toContain('Meta');
  });

  it('does NOT reject "Meta Pixel" / "LinkedIn Insight" tracking-tag mentions', () => {
    const r = checkHeroGrounding(
      hero({
        strength:
          'Tracking is solid: Meta Pixel and LinkedIn Insight Tag are all confirmed firing.',
      }),
      googleOnlyCorpus,
    );
    expect(r.grounded).toBe(true);
    expect(r.ungroundedPlatforms).toEqual([]);
  });

  it('passes Google ad claims when the corpus has a Google count', () => {
    const r = checkHeroGrounding(
      hero({ dmOneLiner: 'You have 7 active Google ads on a slow page.' }),
      googleOnlyCorpus,
    );
    expect(r.grounded).toBe(true);
  });

  it('passes Meta ad claims when a future memo does publish a Meta count', () => {
    const futureCorpus = `${googleOnlyCorpus} Meta Ad Library: 12 active creatives`;
    const r = checkHeroGrounding(
      hero({ dmOneLiner: 'You have 12 active Meta ads on a slow page.' }),
      futureCorpus,
    );
    expect(r.grounded).toBe(true);
  });

  it('passes when JSON serialises a numeric metaActive field', () => {
    const jsonCorpus = `{ "metaActive": 4, "googleActive": 7 }`;
    const r = checkHeroGrounding(
      hero({ dmOneLiner: 'You have 4 active Meta ads.' }),
      jsonCorpus,
    );
    expect(r.grounded).toBe(true);
  });

  it('rejects when JSON serialises metaActive as null', () => {
    const jsonCorpus = `{ "metaActive": null, "googleActive": 7 }`;
    const r = checkHeroGrounding(
      hero({ dmOneLiner: 'You have 4 active Meta ads.' }),
      jsonCorpus,
    );
    expect(r.grounded).toBe(false);
    expect(r.ungroundedPlatforms).toContain('Meta');
  });

  it('rejects implicit-spend framing like "Meta can\'t optimize"', () => {
    const r = checkHeroGrounding(
      hero({ dmOneLiner: '4 of 4 tracking pixels missing, Meta can\'t optimize blind.' }),
      googleOnlyCorpus,
    );
    expect(r.grounded).toBe(false);
    expect(r.ungroundedPlatforms).toContain('Meta');
  });

  it('rejects "LinkedIn is bidding" framing without a LinkedIn count', () => {
    const r = checkHeroGrounding(
      hero({ pageHero: 'Your tracking is dark, so LinkedIn is bidding blind.' }),
      googleOnlyCorpus,
    );
    expect(r.grounded).toBe(false);
    expect(r.ungroundedPlatforms).toContain('LinkedIn');
  });
});

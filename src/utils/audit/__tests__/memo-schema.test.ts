import { describe, it, expect } from 'vitest';
import { MemoSchema, memoToJsonSchema, MEMO_SCHEMA_VERSION } from '../memo-schema';

const validMemo = {
  version: MEMO_SCHEMA_VERSION,
  slug: 'example-com-a1b2cd34ef56gh78',
  domain: 'example.com',
  companyName: 'Example Inc',
  generatedAt: '2026-05-13T20:00:00.000Z',
  cover: {
    kicker: 'Teardown memo · example.com',
    roman: 'Google can find you.',
    italic: 'ChatGPT cannot tell what you sell.',
    dek: 'The boring foundation is in place.',
  },
  verdictCells: [
    {
      icon: 'search',
      heading: 'How Google sees you',
      value: '3 of 4',
      note: 'Crawlable, indexed, canonical. Schema is missing.',
      benchmark: 'Top quartile · 4 of 4',
      checks: [
        { ok: true, text: 'Sitemap reachable · 87 URLs' },
        { ok: false, text: 'JSON-LD schema · LocalBusiness missing' },
      ],
    },
    {
      icon: 'target',
      heading: 'What you measure',
      value: '2 of 5',
      note: 'Meta Pixel fires. GA4 missing.',
      checks: [{ ok: false, text: 'Google Analytics 4 · missing' }],
    },
    {
      icon: 'spark',
      heading: 'When AI mentions you',
      value: '0 of 3',
      note: 'Perplexity, Claude, OpenAI all answered without you.',
      checks: [],
    },
  ],
  rankedFixes: [
    {
      rank: 1,
      what: 'Install GA4 via GTM and wire the lead conversion event.',
      why: 'Google Ads optimization is blind without GA4. Twenty minutes to install.',
      effort: 'low',
      impact: 'high',
    },
    {
      rank: 2,
      what: 'Ship LocalBusiness JSON-LD on the homepage.',
      why: 'Lets AI engines connect your domain to your service area and phone.',
      effort: 'low',
      impact: 'high',
    },
    {
      rank: 3,
      what: 'Cut the LP load time in half.',
      why: 'A 4.2s mobile LCP is dropping ad conversions roughly thirty percent.',
      effort: 'med',
      impact: 'med',
    },
  ],
  personalObservation: {
    text: 'One paragraph of human observation goes here.',
  },
};

describe('MemoSchema', () => {
  it('accepts a valid memo', () => {
    const parsed = MemoSchema.safeParse(validMemo);
    expect(parsed.success).toBe(true);
  });

  it('round-trips JSON', () => {
    const json = JSON.stringify(validMemo);
    const parsed = MemoSchema.safeParse(JSON.parse(json));
    expect(parsed.success).toBe(true);
  });

  it('rejects wrong version', () => {
    const parsed = MemoSchema.safeParse({ ...validMemo, version: '1.0.0' });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed slug', () => {
    const parsed = MemoSchema.safeParse({ ...validMemo, slug: 'no-suffix' });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed generatedAt', () => {
    const parsed = MemoSchema.safeParse({ ...validMemo, generatedAt: '2026-05-13' });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty personalObservation text', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      personalObservation: { text: '' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects fewer than 3 verdict cells', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      verdictCells: validMemo.verdictCells.slice(0, 2),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects more than 8 verdict cells', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({
      icon: 'search',
      heading: `Cell ${i}`,
      value: 'x',
      note: 'note',
      checks: [],
    }));
    const parsed = MemoSchema.safeParse({ ...validMemo, verdictCells: nine });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown verdict icon', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      verdictCells: [
        { ...validMemo.verdictCells[0], icon: 'rocket' as 'search' },
        validMemo.verdictCells[1],
        validMemo.verdictCells[2],
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects empty rankedFixes', () => {
    const parsed = MemoSchema.safeParse({ ...validMemo, rankedFixes: [] });
    expect(parsed.success).toBe(false);
  });

  it('rejects more than 5 rankedFixes', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      rank: i + 1,
      what: `Fix ${i + 1}`,
      why: 'Why this fix matters in concrete terms.',
      effort: 'low',
      impact: 'med',
    }));
    const parsed = MemoSchema.safeParse({ ...validMemo, rankedFixes: six });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid effort value', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      rankedFixes: [
        { ...validMemo.rankedFixes[0], effort: 'enormous' as 'high' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid impact value', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      rankedFixes: [
        { ...validMemo.rankedFixes[0], impact: 'monstrous' as 'high' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a memo with no rankedFix.why missing — rejects', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      rankedFixes: [
        { rank: 1, what: 'A thing', effort: 'low', impact: 'high' },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('memoToJsonSchema', () => {
  it('emits a non-trivial JSON Schema', () => {
    const schema = memoToJsonSchema() as Record<string, unknown>;
    expect(schema).toHaveProperty('properties');
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty('slug');
    expect(props).toHaveProperty('cover');
    expect(props).toHaveProperty('verdictCells');
    expect(props).toHaveProperty('rankedFixes');
    expect(props).toHaveProperty('personalObservation');
    expect(props).toHaveProperty('benchmark');
    expect(props).toHaveProperty('screenshots');
  });
});

describe('optional fields', () => {
  it('accepts benchmark', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      benchmark: {
        industryName: 'Building materials, 16 operators',
        industryN: 16,
        scoreNumeric: 47,
        industryMedian: 64,
        percentile: 32,
        oneLiner: 'Ten of sixteen contractors score higher.',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects benchmark with industryN < 2', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      benchmark: { industryName: 'x', industryN: 1, scoreNumeric: 50, industryMedian: 60 },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts screenshots', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      screenshots: {
        homepageDesktop: 'https://screenshotone.com/shot1.png',
        homepageMobile: 'https://screenshotone.com/shot2.png',
        capturedAt: '2026-05-13T19:00:00.000Z',
        source: 'screenshotone',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts nullish companyName and industry', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      companyName: null,
      industry: null,
      state: null,
      city: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts verdict cell with nullish benchmark', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      verdictCells: [
        { ...validMemo.verdictCells[0], benchmark: null },
        validMemo.verdictCells[1],
        validMemo.verdictCells[2],
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

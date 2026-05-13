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
  aeo: {
    num: '01 · AEO surfaces',
    heading: 'AEO holds.',
    italic: 'Schema gaps cost citations.',
    findings: [],
    bodyParagraphs: ['Body para 1.'],
  },
  tracking: {
    heading: 'Tracking stack.',
    findings: [
      {
        idx: 'F.02.1',
        severity: 'material',
        severityLabel: 'Material',
        heading: 'Meta Pixel missing.',
        paragraphs: ['The pixel is not on the page.'],
      },
    ],
    bodyParagraphs: [],
  },
  conversion: {
    heading: 'Conversion paths.',
    findings: [],
    bodyParagraphs: [],
  },
  adActivity: {
    heading: 'Ad activity.',
    findings: [],
    bodyParagraphs: [],
  },
  personalObservation: {
    text: 'One paragraph here.',
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
    const parsed = MemoSchema.safeParse({ ...validMemo, version: '0.9.0' });
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

  it('rejects missing required sections', () => {
    const { aeo: _aeo, ...partial } = validMemo;
    const parsed = MemoSchema.safeParse(partial);
    expect(parsed.success).toBe(false);
  });

  it('rejects empty personalObservation text', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      personalObservation: { text: '' },
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
    expect(props).toHaveProperty('aeo');
    expect(props).toHaveProperty('personalObservation');
    expect(props).toHaveProperty('benchmark');
    expect(props).toHaveProperty('performance');
    expect(props).toHaveProperty('adLandingPages');
    expect(props).toHaveProperty('organicTraffic');
    expect(props).toHaveProperty('screenshots');
    expect(props).toHaveProperty('aiCitation');
  });
});

describe('optional T1/T2/T3 fields', () => {
  it('accepts benchmark', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      benchmark: {
        industryName: 'Building materials, 26-100 employees',
        industryN: 8,
        scoreNumeric: 47,
        industryMedian: 64,
        percentile: 25,
        oneLiner: 'Pella of Columbus scores below 6 of 8 peers.',
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

  it('accepts performance with mobile only', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      performance: {
        mobile: { lcpMs: 4200, inpMs: 380, cls: 0.12, performanceScore: 38, band: 'poor' },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects performance band invalid value', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      performance: { mobile: { band: 'mediocre' as 'poor' } },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts ad landing pages', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      adLandingPages: [
        {
          url: 'https://pellaofcolumbus.com/replacement-windows-quote',
          platform: 'meta',
          adsActive: 4,
          screenshotDesktop: 'https://example.com/shot.png',
          trackingFindings: ['Meta Pixel present', 'GA4 missing'],
          conversionFindings: ['Quote form behind 3 clicks'],
          driftFromHomepage: 'LP has fewer trust signals than homepage.',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects ad landing pages with invalid url', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      adLandingPages: [{ url: 'not-a-url' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts organic traffic with keywords', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      organicTraffic: {
        estimatedMonthlyVisits: 320,
        estimatedMonthlyValueUsd: 1240,
        source: 'dataforseo',
        topKeywords: [
          { keyword: 'pella windows columbus', position: 3, monthlyVolume: 480 },
          { keyword: 'replacement windows columbus oh', position: 12 },
        ],
      },
    });
    expect(parsed.success).toBe(true);
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

  it('accepts AI citation probes', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      aiCitation: {
        summary: 'Cited 0/3 engines for the operator service query.',
        probes: [
          {
            engine: 'perplexity',
            query: 'who installs Pella windows in Columbus Ohio',
            cited: false,
            competitorsCited: ['rba.com', 'window-world.com'],
          },
          {
            engine: 'claude',
            query: 'best window replacement Columbus Ohio',
            cited: false,
            competitorsCited: ['rba.com'],
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts mobile rendering placeholder', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      mobileRendering: {
        viewport: 'iPhone 15',
        hasHorizontalScroll: true,
        smallestTapTargetPx: 22,
        textTooSmall: false,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts email deliverability placeholder', () => {
    const parsed = MemoSchema.safeParse({
      ...validMemo,
      emailDeliverability: {
        spfPresent: true,
        spfPolicy: 'v=spf1 include:_spf.google.com ~all',
        dmarcPresent: false,
        mxPresent: true,
        mxProvider: 'google',
      },
    });
    expect(parsed.success).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  BRITE_MEMO_SCHEMA_VERSION,
  MEMO_SCHEMA_VERSION,
  MemoSchema,
  type Memo,
} from '../memo-schema';

const baseMemo = {
  slug: 'example-com-a1b2c3d4e5f6g7h8',
  domain: 'example.com',
  generatedAt: '2026-06-05T08:00:00.000Z',
  cover: { kicker: 'Teardown memo', roman: 'The public read is clean.' },
  verdictCells: [
    {
      icon: 'target',
      heading: 'Measurement',
      value: 'Mostly clean',
      note: 'GA4 is present, but demo attribution needs an owner.',
      checks: [{ ok: true, text: 'GA4 present', reliability: 'verified' }],
      role: 'analytics',
      reliability: 'verified',
    },
    {
      icon: 'bar',
      heading: 'Organic demand',
      value: 'Flat',
      note: 'Traffic appears flat against category peers.',
      checks: [{ ok: false, text: 'Traffic is modeled, not measured', reliability: 'inferred' }],
      role: 'technical-seo',
      reliability: 'inferred',
    },
    {
      icon: 'megaphone',
      heading: 'Paid channels',
      value: 'Google only',
      note: 'Meta checks do not apply to the current channel mix.',
      checks: [{ ok: true, text: 'Meta Pixel not applicable', reliability: 'verified-na' }],
      role: 'performance-marketing',
      reliability: 'verified-na',
    },
  ],
  rankedFixes: [
    {
      rank: 1,
      what: 'Give demo attribution one senior owner.',
      why: 'The basics are present. The gap is ownership of the path from paid click to booked demo.',
      effort: 'med',
      impact: 'high',
    },
  ],
  personalObservation: { text: 'The audit reads like a team-gap problem, not a setup problem.' },
} satisfies Omit<Memo, 'version' | 'brand'>;

describe('MemoSchema Brite v3 contract', () => {
  it('keeps brand-absent v2 memos valid and defaults them to Rivett', () => {
    const parsed = MemoSchema.safeParse({
      ...baseMemo,
      version: MEMO_SCHEMA_VERSION,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.brand).toBe('rivett');
      expect(parsed.data.version).toBe('2.0.0');
    }
  });

  it('accepts Brite v3 fields without requiring them on legacy memos', () => {
    const parsed = MemoSchema.safeParse({
      ...baseMemo,
      version: BRITE_MEMO_SCHEMA_VERSION,
      brand: 'brite',
      ctaUrl: 'https://calendly.com/incrementum-team/45-minite-call',
      grade: { letter: 'C-', band: 'gaps', peerLabel: 'B2B SaaS peer floor' },
      roles: [
        {
          id: 'analytics',
          name: 'Marketing / Web Analytics',
          does: 'Owns GA4, ROAS, CAC, dashboards, and attribution.',
          priceMonthly: 2800,
          usEquivAnnual: 180000,
        },
        {
          id: 'technical-seo',
          name: 'Technical SEO',
          does: 'Owns technical organic depth.',
          priceMonthly: 4000,
          usEquivAnnual: 180000,
        },
        {
          id: 'performance-marketing',
          name: 'Performance Marketing',
          does: 'Owns paid signal quality.',
          priceMonthly: 3500,
          usEquivAnnual: 180000,
        },
      ],
      teamGap: {
        headcount: null,
        specialists: [{ role: 'analytics', present: false, who: null }],
        missing: ['analytics'],
        reliability: 'inferred',
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.brand).toBe('brite');
      expect(parsed.data.roles?.[0]?.priceMonthly).toBe(2800);
      expect(parsed.data.teamGap?.missing).toContain('analytics');
    }
  });

  it('rejects Brite v3 cells whose role is not in the memo role catalog', () => {
    const parsed = MemoSchema.safeParse({
      ...baseMemo,
      version: BRITE_MEMO_SCHEMA_VERSION,
      brand: 'brite',
      ctaUrl: 'https://calendly.com/incrementum-team/45-minite-call',
      grade: { letter: 'C-', band: 'gaps', peerLabel: 'B2B SaaS peer floor' },
      roles: [
        {
          id: 'analytics',
          name: 'Marketing / Web Analytics',
          does: 'Owns GA4, ROAS, CAC, dashboards, and attribution.',
          priceMonthly: 2800,
          usEquivAnnual: 180000,
        },
      ],
      teamGap: {
        headcount: null,
        specialists: [{ role: 'analytics', present: false, who: null }],
        missing: ['analytics'],
        reliability: 'inferred',
      },
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'verdictCells.1.role')).toBe(true);
    }
  });

  it('rejects Brite v3 memos without a role catalog', () => {
    const parsed = MemoSchema.safeParse({
      ...baseMemo,
      version: BRITE_MEMO_SCHEMA_VERSION,
      brand: 'brite',
      ctaUrl: 'https://calendly.com/incrementum-team/45-minite-call',
      grade: { letter: 'C-', band: 'gaps', peerLabel: 'B2B SaaS peer floor' },
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'roles')).toBe(true);
    }
  });
});

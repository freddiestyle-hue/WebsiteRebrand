import { describe, it, expect } from 'vitest';
import { synthesizeDiagnosis, buildMemoFromAudit, type EnrichmentBundle } from '../v3-synth';
import type { AuditResult, CheckResult } from '../engine';
import type { PageSpeedResult } from '../pagespeed';
import type { AdsResult } from '../ads-check';
import type { DeliverabilityResult } from '../dns-check';
import { MemoSchema } from '../memo-schema';

function mkCheck(
  o: Partial<CheckResult> & { id: string; category: CheckResult['category']; passed: boolean },
): CheckResult {
  return {
    label: o.id,
    weight: 1,
    evidence: '',
    finding: `Finding for ${o.id}.`,
    reliability: o.passed ? 'verified' : 'soft-absence',
    ...o,
  };
}

function mkAudit(checks: CheckResult[]): AuditResult {
  return {
    url: 'https://acme.test',
    hostname: 'acme.test',
    fetchedAt: new Date().toISOString(),
    durationMs: 100,
    checks,
    scoreNumeric: checks.filter((c) => c.passed).length,
    scoreMax: checks.length,
    scorePercent: 50,
    band: 'weak',
    bandLabel: 'Weak signal',
    bandKicker: 'acme.test is partially readable.',
    verdict: {
      crawl: { grade: 'C', passed: 0, total: 0 },
      schema: { grade: 'C', passed: 0, total: 0 },
      aeo: { grade: 'C', passed: 0, total: 0 },
      sendReady: { grade: 'C', passed: 0, total: 0 },
    },
  };
}

function mkEnrich(over: Partial<EnrichmentBundle> = {}): EnrichmentBundle {
  return {
    deliverability: null,
    mobile: null,
    pageSpeed: null,
    ads: null,
    techStack: null,
    headless: null,
    techStackRuntime: null,
    landing: null,
    ...over,
  };
}

const POOR_SPEED: PageSpeedResult = {
  strategy: 'mobile',
  lcpMs: 4600,
  inpMs: null,
  cls: null,
  fcpMs: null,
  ttfbMs: null,
  performanceScore: 28,
  band: 'poor',
};

describe('synthesizeDiagnosis', () => {
  it('picks the worst failing check when there is no enrichment', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({ id: 'org-schema', category: 'schema', passed: false, weight: 2 }),
        mkCheck({ id: 'meta-author', category: 'meta', passed: false, weight: 1 }),
      ]),
      undefined,
      [],
    );
    expect(s.primaryIssue?.dimension).toBe('org-schema');
    expect(s.crossSignals).toEqual([]);
  });

  it('leads with page speed when ads run into a slow homepage', () => {
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({ pageSpeed: POOR_SPEED, ads: { metaActive: 4, googleActive: 0, linkedinActive: 0 } as AdsResult }),
      [],
    );
    expect(s.primaryIssue?.icon).toBe('bolt');
    expect(s.crossSignals.map((c) => c.key)).toContain('ads-running-slow-page');
    expect(s.crossSignals[0].reliability).toBe('verified');
  });

  it('leads with the conversion path when ads run into a leaky page', () => {
    const s = synthesizeDiagnosis(
      mkAudit([mkCheck({ id: 'conversion-form-on-page', category: 'conversion', passed: false })]),
      mkEnrich({ ads: { metaActive: 2, googleActive: 1, linkedinActive: 0 } as AdsResult }),
      [],
    );
    expect(s.primaryIssue?.icon).toBe('eye');
    expect(s.crossSignals.map((c) => c.key)).toContain('ads-running-conversion-gaps');
  });

  it('a soft conversion gap stays soft - the cross-signal is never asserted as fact', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'conversion-form-on-page',
          category: 'conversion',
          passed: false,
          reliability: 'soft-absence',
        }),
      ]),
      mkEnrich({ ads: { metaActive: 1, googleActive: 0, linkedinActive: 0 } as AdsResult }),
      [],
    );
    const sig = s.crossSignals.find((c) => c.key === 'ads-running-conversion-gaps');
    expect(sig?.reliability).toBe('soft-absence');
    expect(s.primaryIssue?.reliability).toBe('soft-absence');
  });

  it('flags a missing DMARC record', () => {
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({ deliverability: { dmarcPresent: false } as DeliverabilityResult }),
      [],
    );
    expect(s.primaryIssue?.icon).toBe('mail');
    expect(s.crossSignals.map((c) => c.key)).toContain('no-dmarc');
  });

  it('returns no primary issue when nothing fails', () => {
    const s = synthesizeDiagnosis(
      mkAudit([mkCheck({ id: 'org-schema', category: 'schema', passed: true })]),
      undefined,
      [],
    );
    expect(s.primaryIssue).toBeNull();
  });

  it('counts verified versus soft findings across the calibrated cells', () => {
    const s = synthesizeDiagnosis(mkAudit([]), undefined, [
      {
        icon: 'search',
        heading: 'h',
        value: 'v',
        note: 'n',
        checks: [
          { ok: true, text: 'a', reliability: 'verified' },
          { ok: false, text: 'b', reliability: 'soft-absence' },
          { ok: false, text: 'c', reliability: 'inferred' },
        ],
      },
    ]);
    expect(s.verifiedCount).toBe(1);
    expect(s.softCount).toBe(2);
  });
});

describe('verified-only cell counting', () => {
  it('search cell reports verified gaps, not soft-absence counts', () => {
    // 2 verified pass, 1 verified fail, 2 soft-absence fails. Old behaviour
    // would have shown "2 of 5" / "3 gaps". New behaviour: "2 of 3 verified"
    // and "1 verified gap", with the 2 soft rows surfaced as unconfirmed.
    const memo = buildMemoFromAudit(
      mkAudit([
        mkCheck({ id: 'sitemap', category: 'crawl', passed: true }),
        mkCheck({ id: 'robots', category: 'crawl', passed: true }),
        mkCheck({ id: 'org-schema', category: 'schema', passed: false, reliability: 'verified' }),
        mkCheck({ id: 'website-schema', category: 'schema', passed: false, reliability: 'soft-absence' }),
        mkCheck({ id: 'canonical', category: 'meta', passed: false, reliability: 'soft-absence' }),
      ]),
    );
    const search = memo.verdictCells.find((c) => c.icon === 'search');
    expect(search?.value).toBe('2 of 3 verified');
    expect(search?.benchmarkRight).toBe('1 verified gap');
    expect(search?.note).toContain('1 of 3 crawl-and-schema gap verified');
    expect(search?.note).toContain("couldn't be confirmed");
  });

  it('AEO cell reports verified gaps, not soft-absence counts', () => {
    const memo = buildMemoFromAudit(
      mkAudit([
        mkCheck({ id: 'llms-txt', category: 'aeo', passed: false, reliability: 'verified' }),
        mkCheck({ id: 'llms-full', category: 'aeo', passed: true, reliability: 'verified' }),
        mkCheck({ id: 'contact', category: 'aeo', passed: false, reliability: 'soft-absence' }),
      ]),
    );
    const aeo = memo.verdictCells.find((c) => c.icon === 'spark');
    expect(aeo?.value).toBe('1 of 2 verified');
    expect(aeo?.benchmarkRight).toBe('1 verified missing');
  });
});

describe('buildConversionCell with headless trace', () => {
  it('form-on-homepage outcome is reported as a verified clear path', () => {
    const memo = buildMemoFromAudit(
      mkAudit([
        mkCheck({ id: 'conversion-form-on-page', category: 'conversion', passed: false, reliability: 'soft-absence' }),
      ]),
      mkEnrich({
        headless: {
          conversionPath: { primaryCtaText: 'Book a call', outcome: 'form-on-homepage', clicksToForm: 0 },
        } as never,
      }),
    );
    const conv = memo.verdictCells.find((c) => c.icon === 'eye');
    expect(conv?.value).toBe('Verified path');
    expect(conv?.benchmark).toBe('Path · clear');
    expect(conv?.note).toContain('directly on the homepage');
  });

  it('form-after-click outcome is reported as a verified clear path with the CTA', () => {
    const memo = buildMemoFromAudit(
      mkAudit([
        mkCheck({ id: 'conversion-form-on-page', category: 'conversion', passed: false, reliability: 'soft-absence' }),
      ]),
      mkEnrich({
        headless: {
          conversionPath: { primaryCtaText: 'Get a quote', outcome: 'form-after-click', clicksToForm: 1 },
        } as never,
      }),
    );
    const conv = memo.verdictCells.find((c) => c.icon === 'eye');
    expect(conv?.value).toBe('Verified path');
    expect(conv?.note).toContain('"Get a quote"');
    expect(conv?.benchmarkRight).toBe('Form 1 click from CTA');
  });

  it('no-form-reached outcome is reported as a verified gap', () => {
    const memo = buildMemoFromAudit(
      mkAudit([
        mkCheck({ id: 'conversion-form-on-page', category: 'conversion', passed: true, reliability: 'verified' }),
      ]),
      mkEnrich({
        headless: {
          conversionPath: { primaryCtaText: 'Learn more', outcome: 'no-form-reached', clicksToForm: null },
        } as never,
      }),
    );
    const conv = memo.verdictCells.find((c) => c.icon === 'eye');
    expect(conv?.value).toBe('Verified gap');
    expect(conv?.benchmark).toBe('Path · blocked');
    expect(conv?.benchmarkRight).toBe('No form within 1 click');
  });

  it('falls back to verified checks when trace did not run, ignoring soft-absences in gap count', () => {
    const memo = buildMemoFromAudit(
      mkAudit([
        mkCheck({ id: 'conversion-form-on-page', category: 'conversion', passed: true, reliability: 'verified' }),
        mkCheck({ id: 'conversion-tel-link', category: 'conversion', passed: true, reliability: 'verified' }),
        mkCheck({ id: 'conversion-chat-widget', category: 'conversion', passed: false, reliability: 'soft-absence' }),
        mkCheck({ id: 'conversion-scheduling-link', category: 'conversion', passed: false, reliability: 'soft-absence' }),
      ]),
      // No headless - trace did not run.
    );
    const conv = memo.verdictCells.find((c) => c.icon === 'eye');
    // Two verified passes, zero verified fails, two unconfirmed - this is
    // "clear path" with caveats, NOT "4 conversion gaps".
    expect(conv?.value).toBe('2 of 2 verified');
    expect(conv?.benchmarkRight).toBe('Clear');
    expect(conv?.note).toContain("couldn't be confirmed");
  });
});

describe('buildMemoFromAudit (Upgrade 7 wiring)', () => {
  const audit = mkAudit([
    mkCheck({ id: 'sitemap', category: 'crawl', passed: true }),
    mkCheck({ id: 'org-schema', category: 'schema', passed: false }),
    mkCheck({ id: 'llms-txt', category: 'aeo', passed: false, reliability: 'verified' }),
    mkCheck({ id: 'conversion-form-on-page', category: 'conversion', passed: false }),
  ]);

  it('produces a schema-valid memo carrying a synthesis block', () => {
    const memo = buildMemoFromAudit(audit);
    expect(MemoSchema.safeParse(memo).success).toBe(true);
    expect(memo.synthesis).toBeDefined();
    expect(memo.synthesis?.primaryIssue).not.toBeNull();
  });

  it('calibrates every cell that has findings with a reliability tag', () => {
    const memo = buildMemoFromAudit(audit);
    const tagged = memo.verdictCells.filter((c) => c.reliability !== undefined);
    expect(tagged.length).toBeGreaterThan(0);
    for (const cell of tagged) {
      for (const chk of cell.checks) {
        expect(chk.reliability).toBeDefined();
      }
    }
  });
});

describe('rollupReliability weight-aware cascade (Upgrade 8)', () => {
  it('weight-0 soft-absence does not cascade to the cell reliability', () => {
    // Spok scenario: 3 measured trackers verified firing + 3 channel-specific
    // trackers (linkedin/tiktok/posthog) absent at weight 0. Cell headline
    // should read VERIFIED, not UNCONFIRMED - the prospect doesn't run those
    // channels and we shouldn't penalise the cell for absences they don't care
    // about.
    const audit = mkAudit([
      mkCheck({ id: 'tracking-meta-pixel', category: 'tracking', passed: true, weight: 1, reliability: 'verified' }),
      mkCheck({ id: 'tracking-gtm', category: 'tracking', passed: true, weight: 1, reliability: 'verified' }),
      mkCheck({ id: 'tracking-ga4', category: 'tracking', passed: true, weight: 1, reliability: 'verified' }),
      mkCheck({ id: 'tracking-linkedin-insight', category: 'tracking', passed: false, weight: 0, reliability: 'soft-absence' }),
      mkCheck({ id: 'tracking-tiktok-pixel', category: 'tracking', passed: false, weight: 0, reliability: 'soft-absence' }),
      mkCheck({ id: 'tracking-posthog', category: 'tracking', passed: false, weight: 0, reliability: 'soft-absence' }),
    ]);
    const memo = buildMemoFromAudit(audit);
    const target = memo.verdictCells.find((c) => c.icon === 'target');
    expect(target?.reliability).toBe('verified');
  });

  it('weight-1 soft-absence still cascades (real load-bearing miss)', () => {
    // A site missing GA4 specifically - that's a load-bearing absence, the
    // cell should still flag UNCONFIRMED.
    const audit = mkAudit([
      mkCheck({ id: 'tracking-meta-pixel', category: 'tracking', passed: true, weight: 1, reliability: 'verified' }),
      mkCheck({ id: 'tracking-gtm', category: 'tracking', passed: true, weight: 1, reliability: 'verified' }),
      mkCheck({ id: 'tracking-ga4', category: 'tracking', passed: false, weight: 1, reliability: 'soft-absence' }),
    ]);
    const memo = buildMemoFromAudit(audit);
    const target = memo.verdictCells.find((c) => c.icon === 'target');
    expect(target?.reliability).toBe('soft-absence');
  });

  it('weight-0.5 chat-widget soft-absence still cascades', () => {
    // Strict equality to 0 in the cascade - the 0.5-weight chat widget is
    // a smaller signal but still load-bearing. Its absence still flags
    // UNCONFIRMED on the conversion cell.
    const audit = mkAudit([
      mkCheck({ id: 'conversion-chat-widget', category: 'conversion', passed: false, weight: 0.5, reliability: 'soft-absence' }),
    ]);
    const memo = buildMemoFromAudit(audit);
    const conv = memo.verdictCells.find((c) => c.icon === 'eye');
    expect(conv?.reliability).toBe('soft-absence');
  });

  it('cell with only weight-0 checks returns verified by default', () => {
    // Edge case: a cell where every check is informational (weight 0).
    // Rollup returns verified - there's nothing load-bearing to be
    // unconfirmed about. Doesn't happen in current code but guards
    // against future schema drift.
    const audit = mkAudit([
      mkCheck({ id: 'tracking-linkedin-insight', category: 'tracking', passed: false, weight: 0, reliability: 'soft-absence' }),
      mkCheck({ id: 'tracking-tiktok-pixel', category: 'tracking', passed: false, weight: 0, reliability: 'soft-absence' }),
    ]);
    const memo = buildMemoFromAudit(audit);
    const target = memo.verdictCells.find((c) => c.icon === 'target');
    expect(target?.reliability).toBe('verified');
  });
});

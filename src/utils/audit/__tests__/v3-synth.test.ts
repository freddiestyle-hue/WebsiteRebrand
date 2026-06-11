import { describe, it, expect } from 'vitest';
import { synthesizeDiagnosis, buildMemoFromAudit, type EnrichmentBundle } from '../v3-synth';
import type { AuditResult, CheckResult } from '../engine';
import type { PageSpeedResult } from '../pagespeed';
import type { AdsResult } from '../ads-check';
import type { DeliverabilityResult } from '../dns-check';
import { MemoSchema, AUDIT_ENGINE_VERSION } from '../memo-schema';

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
  it('picks the worst verified failing check when there is no enrichment', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'org-schema',
          category: 'schema',
          passed: false,
          weight: 2,
          reliability: 'verified',
        }),
        mkCheck({ id: 'meta-author', category: 'meta', passed: false, weight: 1 }),
      ]),
      undefined,
      [],
    );
    expect(s.primaryIssue?.dimension).toBe('org-schema');
    expect(s.crossSignals).toEqual([]);
  });

  it('never nominates a soft-absence failure as the primary issue', () => {
    // The hero prompt forbids leading with soft-absence findings, so a brief
    // that nominates one is self-contradicting. Soft-only audits get a null
    // primary (the clean-read framing) instead.
    const s = synthesizeDiagnosis(
      mkAudit([mkCheck({ id: 'org-schema', category: 'schema', passed: false, weight: 2 })]),
      undefined,
      [],
    );
    expect(s.primaryIssue).toBeNull();
  });

  it('a lone weight-1 verified failure is below the materiality floor', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'og-type',
          category: 'meta',
          passed: false,
          weight: 1,
          reliability: 'verified',
        }),
      ]),
      undefined,
      [],
    );
    expect(s.primaryIssue).toBeNull();
  });

  it('fallback ties prefer conversion/tracking over crawl', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'sitemap-size',
          category: 'crawl',
          passed: false,
          weight: 2,
          reliability: 'verified',
        }),
        mkCheck({
          id: 'tracking-ga4',
          category: 'tracking',
          passed: false,
          weight: 2,
          reliability: 'verified',
        }),
      ]),
      undefined,
      [],
    );
    expect(s.primaryIssue?.dimension).toBe('tracking-ga4');
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

  it('leads with the conversion path when ads run into a verified leaky page', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'conversion-form-on-page',
          category: 'conversion',
          passed: false,
          reliability: 'verified',
        }),
      ]),
      mkEnrich({ ads: { metaActive: 2, googleActive: 1, linkedinActive: 0 } as AdsResult }),
      [],
    );
    expect(s.primaryIssue?.icon).toBe('eye');
    expect(s.primaryIssue?.reliability).toBe('verified');
    expect(s.crossSignals.map((c) => c.key)).toContain('ads-running-conversion-gaps');
  });

  it('a soft conversion gap stays soft - signalled but never the primary issue', () => {
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
    // No verified gap, no other rung applies: the brief must not nominate
    // the soft finding as the headline.
    expect(s.primaryIssue).toBeNull();
  });

  it('headline gap count includes verified gaps only when soft gaps are mixed in', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'conversion-form-on-page',
          category: 'conversion',
          passed: false,
          reliability: 'verified',
        }),
        mkCheck({
          id: 'conversion-cta',
          category: 'conversion',
          passed: false,
          reliability: 'soft-absence',
        }),
      ]),
      mkEnrich({ ads: { metaActive: 2, googleActive: 0, linkedinActive: 0 } as AdsResult }),
      [],
    );
    expect(s.primaryIssue?.summary).toContain('1 verified');
    expect(s.primaryIssue?.reliability).toBe('verified');
  });

  it('weight-0 channel checks never inflate the gap headline', () => {
    // TikTok / LinkedIn Insight / PostHog say in their own finding text that
    // they only matter for specific channels - a missing TikTok pixel must
    // not become a "conversion or tracking gap" in the headline.
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'tracking-tiktok-pixel',
          category: 'tracking',
          passed: false,
          weight: 0,
          reliability: 'verified',
        }),
      ]),
      mkEnrich({ ads: { metaActive: 3, googleActive: 0, linkedinActive: 0 } as AdsResult }),
      [],
    );
    expect(s.primaryIssue).toBeNull();
    expect(s.crossSignals.map((c) => c.key)).not.toContain('ads-running-conversion-gaps');
  });

  it('withheld ad counts surface as unmeasured, never as "no ads"', () => {
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({
        ads: {
          metaActive: null,
          googleActive: 0,
          linkedinActive: null,
          identityStatus: { meta: 'unverified-link', linkedin: 'no-link' },
        } as AdsResult,
      }),
      [],
    );
    const sig = s.crossSignals.find((c) => c.key === 'ads-unmeasured');
    expect(sig).toBeDefined();
    expect(sig?.reliability).toBe('soft-absence');
    expect(sig?.detail).toContain('withheld, not zero');
  });

  it('a failed ads probe surfaces as unmeasured, never as "no ads"', () => {
    const s = synthesizeDiagnosis(mkAudit([]), mkEnrich({ ads: null }), []);
    const sig = s.crossSignals.find((c) => c.key === 'ads-unmeasured');
    expect(sig).toBeDefined();
    expect(sig?.detail).toContain('not evidence the business runs no ads');
  });

  it('flags unmeasured page speed when ads are running', () => {
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({ ads: { metaActive: 2, googleActive: 0, linkedinActive: 0 } as AdsResult }),
      [],
    );
    expect(s.crossSignals.map((c) => c.key)).toContain('speed-unmeasured');
  });

  it('a conversion dead-end headlines for organic-only sites', () => {
    const deadEndChecks = ['conversion-form', 'conversion-tel', 'conversion-cta'].map((id) =>
      mkCheck({ id, category: 'conversion' as const, passed: false, reliability: 'verified' }),
    );
    const s = synthesizeDiagnosis(mkAudit(deadEndChecks), mkEnrich(), []);
    expect(s.primaryIssue?.icon).toBe('eye');
    expect(s.primaryIssue?.dimension).toBe('Conversion path');
    expect(s.primaryIssue?.summary).toContain('no measurable way to convert');
    expect(s.primaryIssue?.reliability).toBe('verified');
  });

  it('a slow homepage outranks missing DMARC for organic sites', () => {
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({
        pageSpeed: POOR_SPEED,
        deliverability: { dmarcPresent: false } as DeliverabilityResult,
      }),
      [],
    );
    expect(s.primaryIssue?.icon).toBe('bolt');
  });

  it('a single ad is phrased as one ad, not as "paid traffic"', () => {
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({
        pageSpeed: POOR_SPEED,
        ads: { metaActive: 0, googleActive: 1, linkedinActive: 0 } as AdsResult,
      }),
      [],
    );
    expect(s.primaryIssue?.summary).toContain('1 paid ad is sending traffic');
  });

  it('a slow audited landing page beats the homepage story', () => {
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({
        ads: { metaActive: 3, googleActive: 0, linkedinActive: 0 } as AdsResult,
        pageSpeed: POOR_SPEED,
        landing: {
          durationMs: 1,
          pages: [{ url: 'https://acme.test/lp/offer', scorePercent: 22, lcpMs: 6100 }],
        } as never,
      }),
      [],
    );
    expect(s.primaryIssue?.summary).toContain('/lp/offer');
    expect(s.crossSignals.map((c) => c.key)).toContain('ads-running-slow-landing');
  });

  it('fast landing pages kill the "paid traffic on slow homepage" story', () => {
    // Ads provably land on audited pages that are fine; the slow homepage is
    // an organic problem and the brief must not claim paid clicks suffer it.
    const s = synthesizeDiagnosis(
      mkAudit([]),
      mkEnrich({
        ads: { metaActive: 3, googleActive: 0, linkedinActive: 0 } as AdsResult,
        pageSpeed: POOR_SPEED,
        landing: {
          durationMs: 1,
          pages: [{ url: 'https://acme.test/lp/offer', scorePercent: 92, lcpMs: 1400 }],
        } as never,
      }),
      [],
    );
    expect(s.primaryIssue?.summary).not.toMatch(/paid/i);
    expect(s.crossSignals.map((c) => c.key)).toContain('slow-page');
    expect(s.crossSignals.map((c) => c.key)).not.toContain('ads-running-slow-page');
  });

  it('keeps verified not-applicable conversion checks out of gap synthesis', () => {
    const s = synthesizeDiagnosis(
      mkAudit([
        mkCheck({
          id: 'tracking-linkedin-insight',
          category: 'tracking',
          passed: false,
          reliability: 'verified-na',
        }),
      ]),
      mkEnrich({ ads: { metaActive: 1, googleActive: 0, linkedinActive: 0 } as AdsResult }),
      [],
    );
    expect(s.primaryIssue).toBeNull();
    expect(s.crossSignals.map((c) => c.key)).not.toContain('ads-running-conversion-gaps');
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
          { ok: false, text: 'd', reliability: 'verified-na' },
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
    mkCheck({ id: 'llms-txt', category: 'aeo', passed: false, weight: 2, reliability: 'verified' }),
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

  it('verified-na rows stay neutral in cell rollup and synthesis totals', () => {
    const audit = mkAudit([
      mkCheck({ id: 'tracking-linkedin-insight', category: 'tracking', passed: false, reliability: 'verified-na' }),
    ]);
    const memo = buildMemoFromAudit(audit);
    const target = memo.verdictCells.find((c) => c.icon === 'target');
    expect(target?.reliability).toBe('verified-na');
    expect(memo.synthesis?.primaryIssue).toBeNull();
    expect(memo.synthesis?.verifiedCount).toBe(0);
    expect(memo.synthesis?.softCount).toBe(0);
    expect(memo.rankedFixes[0].what).toBe('Keep doing what you are doing.');
  });

  it('memo carries auditVersion = AUDIT_ENGINE_VERSION on every new build (Upgrade 11)', () => {
    // Every fresh memo built via buildMemoFromAudit tags itself with the
    // current engine version so PostHog cohort filters can split 3.4 vs
    // 3.5.x post-ship. Cached pre-Upgrade-11 memos remain valid (the field
    // is optional) but won't carry the version - PostHog will see them
    // as undefined which the filter treats as legacy.
    const memo = buildMemoFromAudit(mkAudit([
      mkCheck({ id: 'sitemap', category: 'crawl', passed: true }),
    ]));
    expect(memo.auditVersion).toBe(AUDIT_ENGINE_VERSION);
    expect(MemoSchema.safeParse(memo).success).toBe(true);
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

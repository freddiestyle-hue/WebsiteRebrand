// Rule-based synthesis: maps AuditResult + enrichment results → v3 Memo.
//
// The audit engine returns categorized findings (crawl, schema, meta, aeo,
// tracking, conversion). Enrichment adds the dimensions the in-browser
// audit can't reach: page speed, mobile rendering, deliverability, ads.
//
// We map each dimension to a verdict cell. The number of cells flexes with
// what data we have — page speed only appears if PSI returned, ads only
// appear if SCRAPECREATORS_API_KEY is set, etc. The schema allows 3-8 cells.

import type { AuditResult, CheckResult } from './engine';
import type { Memo, VerdictCell, RankedFix, VerdictIcon } from './memo-schema';
import { MEMO_SCHEMA_VERSION } from './memo-schema';
import { generateSlug } from './slug';
import type { DeliverabilityResult } from './dns-check';
import type { MobileRenderingResult } from './mobile-check';
import type { PageSpeedResult } from './pagespeed';
import type { AdsResult } from './ads-check';
import type { TechStackResult, DetectedTech, TechCategory } from './tech-stack-check';
import { TECH_CATEGORY_LABELS } from './tech-stack-check';

export interface EnrichmentBundle {
  deliverability: DeliverabilityResult | null;
  mobile: MobileRenderingResult | null;
  pageSpeed: PageSpeedResult | null;
  ads: AdsResult | null;
  techStack: TechStackResult | null;
}

function passCount(checks: CheckResult[]): { passed: number; total: number } {
  const total = checks.length;
  const passed = checks.filter((c) => c.passed).length;
  return { passed, total };
}

function valueStr({ passed, total }: { passed: number; total: number }): string {
  if (total === 0) return 'n/a';
  return `${passed} of ${total}`;
}

function noteFor(
  label: string,
  { passed, total }: { passed: number; total: number },
  ifAll: string,
): string {
  if (total === 0) return `Not measured in this scan.`;
  if (passed === total) return ifAll;
  const gap = total - passed;
  return `${gap} of ${total} ${label} ${gap === 1 ? 'gap' : 'gaps'}.`;
}

function checksFromCategory(checks: CheckResult[]): Array<{ ok: boolean; text: string }> {
  return checks.map((c) => ({ ok: c.passed, text: c.label }));
}

function effortFor(check: CheckResult): 'low' | 'med' | 'high' {
  if (check.weight >= 3) return 'med';
  return 'low';
}

function impactFor(check: CheckResult): 'low' | 'med' | 'high' {
  if (check.weight >= 3) return 'high';
  if (check.weight === 2) return 'med';
  return 'low';
}

function fmtMs(ms: number | null): string {
  if (ms == null) return 'n/a';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function speedCellFromPsi(ps: PageSpeedResult): VerdictCell {
  const value = ps.performanceScore != null ? `${Math.round(ps.performanceScore)} / 100` : 'n/a';
  const note =
    ps.band === 'good'
      ? `Loads fast on mobile. ${fmtMs(ps.lcpMs)} to render the largest content.`
      : ps.band === 'needs-improvement'
        ? `Borderline. ${fmtMs(ps.lcpMs)} LCP, ${fmtMs(ps.fcpMs)} FCP on mobile.`
        : `Slow. ${fmtMs(ps.lcpMs)} LCP, ${fmtMs(ps.fcpMs)} FCP. Ad conversions drop ~7% per second of delay.`;
  const checks = [
    {
      ok: ps.lcpMs != null && ps.lcpMs <= 2500,
      text: `Largest content paints in ${fmtMs(ps.lcpMs)} (Google "good" threshold: 2.5s)`,
    },
    {
      ok: ps.fcpMs != null && ps.fcpMs <= 1800,
      text: `First content paints in ${fmtMs(ps.fcpMs)} (Google "good" threshold: 1.8s)`,
    },
    {
      ok: ps.cls != null && ps.cls <= 0.1,
      text: `Layout shift: ${ps.cls?.toFixed(2) ?? 'n/a'} (Google "good" threshold: 0.10)`,
    },
    {
      ok: ps.inpMs != null && ps.inpMs <= 200,
      text: `Tap responsiveness: ${fmtMs(ps.inpMs)} (Google "good" threshold: 200ms)`,
    },
  ];
  return {
    icon: 'bolt' as VerdictIcon,
    heading: 'How fast it loads',
    value,
    note,
    benchmark: ps.band === 'good' ? 'Top quartile · ≤ 1.9s LCP' : null,
    checks,
  };
}

function mobileCellFromResult(m: MobileRenderingResult): VerdictCell {
  const issues =
    Number(!m.viewportPresent) +
    Number(m.viewportZoomDisabled) +
    Number(m.smallFontHint) +
    Number(m.smallTapTargetHint);
  const value = issues === 0 ? 'Clean' : `${issues} issue${issues === 1 ? '' : 's'}`;
  const note =
    issues === 0
      ? 'Viewport set correctly. No obvious phone-hostile sizing.'
      : 'Markup shows signals that suggest the page is not designed for phones.';
  const checks = [
    { ok: m.viewportPresent, text: 'Viewport meta tag present' },
    { ok: !m.viewportZoomDisabled, text: 'Zoom is not blocked' },
    { ok: !m.smallFontHint, text: 'No font sizes under 12px in markup' },
    { ok: !m.smallTapTargetHint, text: 'No button or link sizes under 40px in markup' },
  ];
  return {
    icon: 'phone' as VerdictIcon,
    heading: 'How it behaves on mobile',
    value,
    note,
    benchmark: null,
    checks,
  };
}

function mailCellFromResult(d: DeliverabilityResult): VerdictCell {
  const okCount =
    Number(d.spfPresent === true) +
    Number(d.dmarcPresent === true && (d.dmarcPolicy === 'reject' || d.dmarcPolicy === 'quarantine')) +
    Number(d.mxPresent === true);
  const value = `${okCount} of 3`;
  const note =
    okCount === 3
      ? 'Authenticated, protected, and receiving mail. Outbound lands.'
      : 'Mail-authentication gaps detected. Outbound risks the spam folder.';
  const checks = [
    {
      ok: d.spfPresent === true,
      text: `SPF: ${d.spfPresent ? `present (${d.spfPolicy ?? 'unknown policy'})` : 'missing'}`,
    },
    {
      ok: d.dmarcPresent === true && (d.dmarcPolicy === 'reject' || d.dmarcPolicy === 'quarantine'),
      text: `DMARC: ${
        d.dmarcPresent
          ? d.dmarcPolicy === 'reject'
            ? 'reject (strongest policy)'
            : d.dmarcPolicy === 'quarantine'
              ? 'quarantine (medium policy)'
              : `${d.dmarcPolicy ?? 'monitor-only'} (no enforcement)`
          : 'missing'
      }`,
    },
    {
      ok: d.mxPresent === true,
      text: `MX records: ${d.mxPresent ? `present (${d.mxProvider ?? 'unknown provider'})` : 'missing'}`,
    },
  ];
  return {
    icon: 'mail' as VerdictIcon,
    heading: 'Email reputation',
    value,
    note,
    benchmark: null,
    checks,
  };
}

function adsCellFromResult(a: AdsResult): VerdictCell {
  const total = (a.metaActive ?? 0) + (a.googleActive ?? 0) + (a.linkedinActive ?? 0);
  const platformsLive = Number((a.metaActive ?? 0) > 0) + Number((a.googleActive ?? 0) > 0) + Number((a.linkedinActive ?? 0) > 0);
  const value = total === 0 ? 'None active' : `${total} active`;
  const note =
    total === 0
      ? `No active paid ads detected across Meta, Google, or LinkedIn. Either paid is not part of the mix or campaigns are paused.`
      : a.commentary;
  const checks: Array<{ ok: boolean; text: string }> = [];
  if (a.metaActive != null) {
    checks.push({
      ok: a.metaActive > 0,
      text:
        a.metaActive === 0
          ? `Meta Ad Library: no active creatives`
          : `Meta Ad Library: ${a.metaActive} active ${a.metaActive === 1 ? 'creative' : 'creatives'}`,
    });
  }
  if (a.googleActive != null) {
    checks.push({
      ok: a.googleActive > 0,
      text:
        a.googleActive === 0
          ? `Google Ads Library: no active creatives`
          : `Google Ads Library: ${a.googleActive} active ${a.googleActive === 1 ? 'creative' : 'creatives'}`,
    });
  }
  if (a.linkedinActive != null) {
    checks.push({
      ok: a.linkedinActive > 0,
      text:
        a.linkedinActive === 0
          ? `LinkedIn Ad Library: no active creatives`
          : `LinkedIn Ad Library: ${a.linkedinActive} active ${a.linkedinActive === 1 ? 'creative' : 'creatives'}`,
    });
  }
  for (const lp of a.sampleLandingPages.slice(0, 2)) {
    checks.push({ ok: false, text: `Ad landing page: ${lp}` });
  }
  const benchmarkParts: string[] = [];
  if (platformsLive > 0) benchmarkParts.push(`${platformsLive} of 3 platforms`);
  if (a.earliestSeen) benchmarkParts.push(`earliest creative ${a.earliestSeen}`);
  const benchmark = benchmarkParts.length > 0 ? benchmarkParts.join(' · ') : null;
  return {
    icon: 'megaphone' as VerdictIcon,
    heading: 'Ads you are running',
    value,
    note,
    benchmark,
    checks,
  };
}

function techStackCellFromResult(t: TechStackResult): VerdictCell {
  // Categories sorted by what an operator cares about most.
  const CATEGORY_ORDER: TechCategory[] = [
    'analytics',
    'advertising',
    'tag-manager',
    'forms-crm',
    'support',
    'consent',
    'ab-testing',
    'ecommerce',
    'cms',
    'framework',
    'hosting',
    'cdn',
    'scheduling',
    'video',
    'reviews',
    'email-marketing',
    'fonts',
    'misc',
  ];

  const value = t.total === 0 ? 'n/a' : String(t.total);
  const note =
    t.total === 0
      ? 'No technologies detected from the static HTML scan. Either the page is very minimal, or everything is being loaded via runtime JS (Tier 2 headless will catch that).'
      : `${t.total} technologies detected across ${Object.keys(t.byCategory).length} categories.`;

  const checks: Array<{ ok: boolean; text: string }> = [];
  for (const cat of CATEGORY_ORDER) {
    const techs = t.byCategory[cat];
    if (!techs || techs.length === 0) continue;
    const names = techs.map((tt) => tt.name).join(', ');
    checks.push({ ok: true, text: `${TECH_CATEGORY_LABELS[cat]}: ${names}` });
  }

  return {
    icon: 'flag' as VerdictIcon,
    heading: 'Tech stack you are running',
    value,
    note,
    benchmark: t.total > 0 ? `${Object.keys(t.byCategory).length} categories detected` : null,
    checks,
  };
}

function augmentTrackingChecks(
  engineChecks: CheckResult[],
  tech: TechStackResult | null,
): Array<{ ok: boolean; text: string }> {
  // Start with what engine.ts caught
  const out: Array<{ ok: boolean; text: string }> = engineChecks.map((c) => ({
    ok: c.passed,
    text: c.label,
  }));

  if (!tech) return out;

  // Add detected advertising pixels + analytics that engine.ts didn't surface.
  // These come from the fingerprint DB so we cover much more than the narrow
  // hand-rolled patterns in engine.ts/tracking.ts.
  const adAndAnalytics = (tech.byCategory.advertising ?? []).concat(tech.byCategory.analytics ?? []);
  const seenNames = new Set<string>();
  // Crude de-dupe: don't double-count "Google Analytics 4" if engine.ts already
  // checked GA via its own pattern.
  for (const c of out) seenNames.add(c.text.toLowerCase());

  for (const tech of adAndAnalytics) {
    const text = `${tech.name}: detected`;
    const key = text.toLowerCase();
    if (!seenNames.has(key)) {
      out.push({ ok: true, text });
      seenNames.add(key);
    }
  }

  return out;
}

export function buildMemoFromAudit(audit: AuditResult, enrich?: EnrichmentBundle): Memo {
  const slug = generateSlug(audit.hostname);

  // Combine crawl + schema + meta + aeo into a single "How Google sees you"
  // cell — they're all really "is this site set up to be found." Keeps the
  // grid under 8 cells when enrichments also fire.
  const searchish = audit.checks.filter(
    (c) => c.category === 'crawl' || c.category === 'schema' || c.category === 'meta' || c.category === 'aeo',
  );
  const tracking = audit.checks.filter((c) => c.category === 'tracking');
  const conversion = audit.checks.filter((c) => c.category === 'conversion');

  const verdictCells: VerdictCell[] = [];

  if (searchish.length > 0) {
    verdictCells.push({
      icon: 'search' as VerdictIcon,
      heading: 'How Google sees you',
      value: valueStr(passCount(searchish)),
      note: noteFor(
        'discoverability',
        passCount(searchish),
        'Crawlable, indexed, schema present, AEO-ready.',
      ),
      benchmark: null,
      checks: checksFromCategory(searchish),
    });
  }

  if (enrich?.pageSpeed) {
    verdictCells.push(speedCellFromPsi(enrich.pageSpeed));
  }

  if (tracking.length > 0) {
    const augmentedChecks = augmentTrackingChecks(tracking, enrich?.techStack ?? null);
    // Recompute passed count to include fingerprint-detected pixels (always
    // "passed" = "detected" since they're proof of presence, not absence).
    const passedCount = augmentedChecks.filter((c) => c.ok).length;
    const totalCount = augmentedChecks.length;
    verdictCells.push({
      icon: 'target' as VerdictIcon,
      heading: 'What you measure',
      value: `${passedCount} of ${totalCount}`,
      note:
        totalCount === passedCount
          ? 'Every tracker we look for is firing.'
          : `${totalCount - passedCount} of ${totalCount} measurement gaps.`,
      benchmark: null,
      checks: augmentedChecks,
    });
  }

  if (enrich?.ads) {
    verdictCells.push(adsCellFromResult(enrich.ads));
  }

  if (conversion.length > 0) {
    verdictCells.push({
      icon: 'eye' as VerdictIcon,
      heading: 'How visitors convert',
      value: valueStr(passCount(conversion)),
      note: noteFor('conversion', passCount(conversion), 'Clear path, strong CTAs, tappable contact.'),
      benchmark: null,
      checks: checksFromCategory(conversion),
    });
  }

  if (enrich?.mobile) {
    verdictCells.push(mobileCellFromResult(enrich.mobile));
  }

  if (enrich?.deliverability) {
    verdictCells.push(mailCellFromResult(enrich.deliverability));
  }

  if (enrich?.techStack && enrich.techStack.total > 0) {
    verdictCells.push(techStackCellFromResult(enrich.techStack));
  }

  // Pad if under the 3-cell minimum (only happens on heavy fetch failure)
  while (verdictCells.length < 3) {
    verdictCells.push({
      icon: 'flag' as VerdictIcon,
      heading: 'Not measured',
      value: 'n/a',
      note: 'This dimension is not part of the in-browser audit.',
      benchmark: null,
      checks: [],
    });
  }

  // Trim if over the 10-cell maximum (shouldn't happen with current cells, but safe)
  const trimmedCells = verdictCells.slice(0, 10);

  // Ranked fixes: enrichment-driven priorities first (page speed, DMARC, viewport
  // are the highest-leverage wins when broken), then top failing audit checks.
  const failed = audit.checks.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight);
  const enrichmentFixes: RankedFix[] = [];

  if (enrich?.pageSpeed && enrich.pageSpeed.band === 'poor') {
    enrichmentFixes.push({
      rank: 0,
      what: `Cut mobile load time. Current LCP: ${fmtMs(enrich.pageSpeed.lcpMs)}.`,
      why: `Google flags anything over 2.5 seconds as poor. Ad conversions drop roughly seven percent per second of delay. This is the highest-leverage performance work.`,
      effort: 'med',
      impact: 'high',
    });
  }

  if (enrich?.deliverability && enrich.deliverability.dmarcPresent === false) {
    enrichmentFixes.push({
      rank: 0,
      what: `Publish a DMARC record with a quarantine or reject policy.`,
      why: `Without DMARC, anyone can send mail pretending to be you. Mail providers increasingly use DMARC presence as a deliverability signal. Twenty minutes to add, takes effect within hours.`,
      effort: 'low',
      impact: 'high',
    });
  }

  if (enrich?.mobile && !enrich.mobile.viewportPresent) {
    enrichmentFixes.push({
      rank: 0,
      what: `Add the viewport meta tag.`,
      why: `Without <code>&lt;meta name="viewport"&gt;</code>, phones render the page at desktop width. Visitors zoom and pinch to read. One line of HTML in the head.`,
      effort: 'low',
      impact: 'high',
    });
  }

  let rankedFixes: RankedFix[];
  if (failed.length === 0 && enrichmentFixes.length === 0) {
    rankedFixes = [
      {
        rank: 1,
        what: 'Keep doing what you are doing.',
        why: 'Every check this scan can measure is passing. The next move is signals this audit cannot see: AI citation probes, benchmark percentile against your peer cohort. Run the full memo pipeline for a real prospect read.',
        effort: 'low',
        impact: 'low',
      },
    ];
  } else {
    const combined: RankedFix[] = [
      ...enrichmentFixes,
      ...failed.slice(0, 3).map((c) => ({
        rank: 0,
        what: c.label.trim().endsWith('.') ? c.label : `${c.label}.`,
        why: c.finding,
        effort: effortFor(c),
        impact: impactFor(c),
      })),
    ];
    rankedFixes = combined.slice(0, 3).map((f, i) => ({ ...f, rank: i + 1 }));
  }

  // Cover italic clause: lead with the most prospect-relevant signal we have.
  let coverItalic = `${audit.bandLabel}. ${audit.bandKicker}`;
  if (enrich?.pageSpeed?.band === 'poor') {
    coverItalic = `${audit.bandLabel}. Mobile load ${fmtMs(enrich.pageSpeed.lcpMs)} is bleeding paid clicks.`;
  } else if (enrich?.deliverability?.dmarcPresent === false) {
    coverItalic = `${audit.bandLabel}. No DMARC published: outbound mail risks the spam folder.`;
  } else if (enrich?.ads && (enrich.ads.metaActive ?? 0) + (enrich.ads.googleActive ?? 0) > 0) {
    const total = (enrich.ads.metaActive ?? 0) + (enrich.ads.googleActive ?? 0);
    coverItalic = `${audit.bandLabel}. ${total} paid ${total === 1 ? 'ad' : 'ads'} currently running.`;
  }

  const dekParts: string[] = [];
  dekParts.push(`Live in-browser scan across ${trimmedCells.length} dimensions.`);
  const enrichedCount = [enrich?.pageSpeed, enrich?.mobile, enrich?.deliverability, enrich?.ads].filter(Boolean).length;
  if (enrichedCount > 0) {
    dekParts.push(
      `Includes real performance numbers, mail-auth records${enrich?.ads ? ', and live ad-library data' : ''}.`,
    );
  }
  dekParts.push(
    `Does not include AI citation probes or benchmark percentile — those need the offline pipeline.`,
  );

  let observation: string;
  if (failed.length === 0 && enrichmentFixes.length === 0) {
    observation = `Every check this audit can run is passing, which is rare. The next layer is the part we did not measure here: are your AI engine citations on the right side of the brand, does your peer cohort score above or below you. Those are the questions worth answering next.`;
  } else if (enrich?.pageSpeed?.band === 'poor') {
    observation = `${audit.hostname} loads slowly on mobile (LCP ${fmtMs(enrich.pageSpeed.lcpMs)}). <strong>If you are spending on paid ads, this is the highest-leverage fix in the audit.</strong> Every second over 2.5s drops conversion roughly seven percent. The other checks matter, but page speed touches every dollar of paid traffic.`;
  } else if (failed.length >= 3) {
    observation = `${audit.hostname} has ${failed.length} measurable gaps in the in-browser scan. The top three are above. <strong>What this scan does not see often matters more</strong>: AI engines naming a competitor instead of you, peer-cohort percentile against your industry. Those questions are worth answering next.`;
  } else {
    observation = `${audit.hostname} is in decent shape on the dimensions this scan can measure. The fixes above will close the obvious gaps. Beyond them, the questions worth answering: how does your peer cohort score, are AI engines naming you when their users ask for your service.`;
  }

  const memo: Memo = {
    version: MEMO_SCHEMA_VERSION,
    slug,
    domain: audit.hostname,
    companyName: null,
    industry: null,
    employees: null,
    state: null,
    city: null,
    generatedAt: audit.fetchedAt,
    cover: {
      kicker: `Live audit · ${audit.hostname}`,
      roman: `Your site scores ${audit.scoreNumeric} of ${audit.scoreMax}.`,
      italic: coverItalic,
      dek: dekParts.join(' '),
    },
    benchmark: undefined,
    screenshots: undefined,
    verdictCells: trimmedCells,
    rankedFixes,
    personalObservation: { text: observation },
  };

  return memo;
}

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
import type {
  Memo,
  VerdictCell,
  VerdictCheck,
  RankedFix,
  VerdictIcon,
  Reliability,
  Synthesis,
  CrossSignal,
} from './memo-schema';
import { MEMO_SCHEMA_VERSION } from './memo-schema';
import { generateSlug } from './slug';
import type { DeliverabilityResult } from './dns-check';
import type { MobileRenderingResult } from './mobile-check';
import type { PageSpeedResult } from './pagespeed';
import type { AdsResult } from './ads-check';
import type { TechStackResult, DetectedTech, TechCategory } from './tech-stack-check';
import { TECH_CATEGORY_LABELS } from './tech-stack-check';
import type { HeadlessResult } from './headless-check';
import type { LandingAuditResult, LandingPageResult } from './landing-check';
import type { PixelMeasurement } from './tracking';

export interface EnrichmentBundle {
  deliverability: DeliverabilityResult | null;
  mobile: MobileRenderingResult | null;
  pageSpeed: PageSpeedResult | null;
  ads: AdsResult | null;
  techStack: TechStackResult | null;
  // Tier 2: when headless ran, this carries rendered HTML + real mobile
  // signals. The synth uses it to upgrade the mobile cell and to fortify
  // the tech-stack cell with runtime-detected pixels.
  headless: HeadlessResult | null;
  // tech-stack re-detected against the rendered HTML, capturing GTM-
  // injected pixels that the static scan misses.
  techStackRuntime: TechStackResult | null;
  // Landing-page sub-audit: lite-scan against each URL the operator is
  // paying ads to send traffic to. The money pages, not the homepage.
  landing: LandingAuditResult | null;
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

function checksFromCategory(checks: CheckResult[]): VerdictCheck[] {
  return checks.map((c) => ({ ok: c.passed, text: c.label, reliability: c.reliability }));
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
  const fails = checks.filter((c) => !c.ok).length;
  const bandWord = ps.band === 'good' ? 'hot' : ps.band === 'needs-improvement' ? 'warm' : 'cold';
  return {
    icon: 'bolt' as VerdictIcon,
    heading: 'How fast it loads',
    value,
    note,
    benchmark: `Mobile · ${bandWord}`,
    benchmarkRight: fails === 0 ? 'Core Vitals OK' : `${fails} of ${checks.length} fail`,
    checks,
  };
}

function mobileCellFromResult(
  m: MobileRenderingResult,
  headless: HeadlessResult | null,
): VerdictCell {
  // If we have headless data, use real measurements. Otherwise fall back
  // to HTML-only inference from m.
  const useHeadless = headless !== null;
  const hm = headless?.mobile;

  const realHorizontalScroll = hm?.hasHorizontalScroll ?? null;
  const realSmallestTap = hm?.smallestTapTargetPx ?? null;
  const realSmallText = (hm?.textSamplesUnder12px ?? 0) > 0;

  // Issues: prefer real signals from headless, fall back to inferred.
  const viewportOk = m.viewportPresent;
  const zoomOk = !m.viewportZoomDisabled;
  const horizontalScrollOk =
    realHorizontalScroll != null ? !realHorizontalScroll : true;
  const tapTargetOk =
    realSmallestTap != null ? realSmallestTap >= 40 : !m.smallTapTargetHint;
  const textSizeOk = useHeadless ? !realSmallText : !m.smallFontHint;

  const issues =
    Number(!viewportOk) +
    Number(!zoomOk) +
    Number(!horizontalScrollOk) +
    Number(!tapTargetOk) +
    Number(!textSizeOk);
  const value = issues === 0 ? 'Clean' : `${issues} issue${issues === 1 ? '' : 's'}`;
  const note =
    issues === 0
      ? useHeadless
        ? 'Renders cleanly at 390×844. No horizontal scroll, tap targets in range.'
        : 'Viewport set correctly. No obvious phone-hostile sizing in markup.'
      : useHeadless
        ? 'Real-browser render at 390×844 surfaced mobile UX issues.'
        : 'Markup shows signals that suggest the page is not designed for phones.';

  const checks: Array<{ ok: boolean; text: string }> = [];
  checks.push({ ok: viewportOk, text: 'Viewport meta tag present' });
  checks.push({ ok: zoomOk, text: 'Zoom is not blocked' });

  if (realHorizontalScroll != null) {
    checks.push({
      ok: !realHorizontalScroll,
      text: realHorizontalScroll
        ? 'Page is wider than the phone viewport (visitors swipe sideways)'
        : 'Page fits the phone viewport cleanly',
    });
  }
  if (realSmallestTap != null) {
    checks.push({
      ok: realSmallestTap >= 40,
      text:
        realSmallestTap >= 40
          ? `Smallest tap target: ${realSmallestTap}px (Apple HIG threshold 44px, Google 48px)`
          : `Smallest tap target: ${realSmallestTap}px — fat-finger misses likely`,
    });
  } else {
    checks.push({
      ok: !m.smallTapTargetHint,
      text: 'No button or link sizes under 40px in markup (static check)',
    });
  }
  if (useHeadless) {
    checks.push({
      ok: !realSmallText,
      text:
        (hm?.textSamplesUnder12px ?? 0) === 0
          ? 'All sampled text renders ≥ 12px on phone viewport'
          : `${hm?.textSamplesUnder12px} text elements render under 12px on phone`,
    });
  } else {
    checks.push({
      ok: !m.smallFontHint,
      text: 'No font sizes under 12px in markup (static check)',
    });
  }

  return {
    icon: 'phone' as VerdictIcon,
    heading: 'How it behaves on mobile',
    value,
    note,
    benchmark: useHeadless ? '390×844 · verified' : '390×844 · inferred',
    benchmarkRight: useHeadless ? 'Tier 2 active' : 'Static only',
    checks,
  };
}

function mailCellFromResult(d: DeliverabilityResult): VerdictCell {
  const dmarcOk = d.dmarcPresent === true && (d.dmarcPolicy === 'reject' || d.dmarcPolicy === 'quarantine');
  const okCount =
    Number(d.spfPresent === true) +
    Number(dmarcOk) +
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
  // bench-right surfaces the first authoritative gap as a status keyword.
  let benchRight: string;
  if (okCount === 3) benchRight = 'All three pass';
  else if (!dmarcOk) benchRight = 'DMARC missing';
  else if (d.spfPresent !== true) benchRight = 'SPF missing';
  else if (d.mxPresent !== true) benchRight = 'MX missing';
  else benchRight = `${3 - okCount} gap${3 - okCount === 1 ? '' : 's'}`;
  return {
    icon: 'mail' as VerdictIcon,
    heading: 'Email reputation',
    value,
    note,
    benchmark: 'DoH · Cloudflare',
    benchmarkRight: benchRight,
    checks,
  };
}

function shortenPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '');
    return path.length > 36 ? path.slice(0, 33) + '...' : path;
  } catch {
    return url;
  }
}

function adsCellFromResult(
  a: AdsResult,
  landing?: LandingAuditResult | null,
  homepageScore?: number | null,
): VerdictCell {
  const total = (a.metaActive ?? 0) + (a.googleActive ?? 0) + (a.linkedinActive ?? 0);
  const platformsLive = Number((a.metaActive ?? 0) > 0) + Number((a.googleActive ?? 0) > 0) + Number((a.linkedinActive ?? 0) > 0);
  const value = total === 0 ? 'None active' : `${total} active`;

  // Money-page leak detection: if ads are running and a landing page scores
  // measurably worse than the homepage, that's the headline.
  const landingPages = landing?.pages ?? [];
  const homepageRef = homepageScore ?? null;
  const worstLanding = landingPages.reduce<LandingPageResult | null>((worst, p) => {
    if (p.scorePercent == null) return worst;
    if (!worst || (worst.scorePercent != null && p.scorePercent < worst.scorePercent)) return p;
    return worst;
  }, null);
  const homepageVsLandingGap =
    homepageRef != null && worstLanding?.scorePercent != null
      ? homepageRef - worstLanding.scorePercent
      : null;

  let note: string;
  if (total === 0) {
    note = `No active paid ads detected across Meta, Google, or LinkedIn. Either paid is not part of the mix or campaigns are paused.`;
  } else if (worstLanding && homepageVsLandingGap != null && homepageVsLandingGap >= 15) {
    note = `${total} active ${total === 1 ? 'ad' : 'ads'}, landing on a page scoring ${Math.round(worstLanding.scorePercent ?? 0)} versus the homepage at ${Math.round(homepageRef ?? 0)}. Paid clicks land where conversion gaps are worst.`;
  } else if (worstLanding && worstLanding.trackingGaps >= 2) {
    note = `${total} active ${total === 1 ? 'ad' : 'ads'}. Landing pages missing core pixels (${worstLanding.trackingGaps} of 4 trackers absent). Meta and Google can't optimise against conversions they can't see.`;
  } else {
    note = a.commentary;
  }

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

  // Per-landing-page findings. Replaces the old static "Ad landing page: URL"
  // bullet with a real diagnostic per page.
  for (const lp of landingPages) {
    if (lp.fetchError) {
      checks.push({
        ok: false,
        text: `Ad landing <b>${shortenPath(lp.url)}</b>: scan blocked (${lp.fetchError})`,
      });
      continue;
    }
    const parts: string[] = [];
    if (lp.scorePercent != null) parts.push(`${Math.round(lp.scorePercent)} of 100`);
    if (lp.trackingGaps > 0) parts.push(`${lp.trackingGaps} of 4 trackers missing`);
    if (lp.conversionGaps > 0) parts.push(`${lp.conversionGaps} of 3 conversion gaps`);
    const noIssues = parts.length === 0 || (lp.trackingGaps === 0 && lp.conversionGaps === 0);
    const ok = noIssues && (lp.scorePercent == null || lp.scorePercent >= 50);
    checks.push({
      ok,
      text: `Ad landing <b>${shortenPath(lp.url)}</b>: ${parts.length ? parts.join(' · ') : 'clean'}`,
    });
  }
  // If we never ran landing audits (ads-disabled run), fall back to listing
  // the captured URLs so the operator still sees where paid traffic goes.
  if (landingPages.length === 0) {
    for (const lp of a.sampleLandingPages.slice(0, 2)) {
      checks.push({ ok: false, text: `Ad landing page: ${shortenPath(lp)} (not audited)` });
    }
  }
  const benchLeft = total === 0 ? '0 of 3 platforms' : `${platformsLive} of 3 platforms`;
  // Format earliest as YYYY·MM if it parses, otherwise pass through verbatim.
  let benchRight: string | null = null;
  if (a.earliestSeen) {
    const d = new Date(a.earliestSeen);
    if (!Number.isNaN(d.getTime())) {
      benchRight = `Earliest ${d.getUTCFullYear()}·${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    } else {
      benchRight = `Earliest ${a.earliestSeen}`;
    }
  } else if (total === 0) {
    benchRight = 'None active';
  }
  return {
    icon: 'megaphone' as VerdictIcon,
    heading: 'Ads running today',
    value,
    note,
    benchmark: benchLeft,
    benchmarkRight: benchRight,
    checks,
  };
}

function mergeTechResults(
  staticResult: TechStackResult,
  runtimeResult: TechStackResult | null,
): { merged: TechStackResult; runtimeOnly: Set<string> } {
  if (!runtimeResult) return { merged: staticResult, runtimeOnly: new Set() };

  const seen = new Map<string, DetectedTech>();
  for (const t of staticResult.detected) seen.set(t.name, t);

  const runtimeOnly = new Set<string>();
  for (const t of runtimeResult.detected) {
    if (!seen.has(t.name)) {
      seen.set(t.name, t);
      runtimeOnly.add(t.name);
    }
  }

  const detected = [...seen.values()];
  const byCategory: Record<TechCategory, DetectedTech[]> = {} as Record<TechCategory, DetectedTech[]>;
  for (const tech of detected) {
    if (!byCategory[tech.category]) byCategory[tech.category] = [];
    byCategory[tech.category].push(tech);
  }

  return {
    merged: { detected, byCategory, total: detected.length },
    runtimeOnly,
  };
}

function techStackCellFromResult(
  staticResult: TechStackResult,
  runtimeResult: TechStackResult | null,
): VerdictCell {
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

  const { merged: t, runtimeOnly } = mergeTechResults(staticResult, runtimeResult);

  const hasRuntime = runtimeResult !== null;
  const value = t.total === 0 ? 'n/a' : String(t.total);
  let note: string;
  if (t.total === 0) {
    note = hasRuntime
      ? 'No technologies detected even after a full headless browser pass with scroll simulation.'
      : 'No technologies detected from the static HTML scan. Runtime JS may be hiding them.';
  } else if (hasRuntime && runtimeOnly.size > 0) {
    note = `${t.total} technologies detected (${runtimeOnly.size} only visible after JS executed and the page was scrolled). Sub-pixels GTM fires on specific user events may not all appear here. Run the diagnostic for the full container audit.`;
  } else if (hasRuntime) {
    note = `${t.total} technologies detected across ${Object.keys(t.byCategory).length} categories (static HTML + headless render + scroll simulation). Sub-pixels GTM fires on specific user events may not all appear.`;
  } else {
    note = `${t.total} technologies detected from the static HTML scan across ${Object.keys(t.byCategory).length} categories.`;
  }

  const checks: Array<{ ok: boolean; text: string }> = [];
  for (const cat of CATEGORY_ORDER) {
    const techs = t.byCategory[cat];
    if (!techs || techs.length === 0) continue;
    const names = techs
      .map((tt) => (runtimeOnly.has(tt.name) ? `${tt.name} (runtime)` : tt.name))
      .join(', ');
    checks.push({ ok: true, text: `${TECH_CATEGORY_LABELS[cat]}: ${names}` });
  }

  const catCount = Object.keys(t.byCategory).length;
  return {
    icon: 'flag' as VerdictIcon,
    heading: 'The stack you actually run',
    value,
    note,
    benchmark:
      t.total > 0
        ? hasRuntime
          ? `${catCount} categories · verified`
          : `${catCount} categories · static`
        : null,
    benchmarkRight:
      t.total === 0
        ? 'Nothing detected'
        : hasRuntime && runtimeOnly.size > 0
          ? `+${runtimeOnly.size} runtime`
          : hasRuntime
            ? 'Static only'
            : 'No headless pass',
    checks,
  };
}

// Upgrade 3 - the one-line label for a tracking row, stating the honest
// measured state rather than a bare pixel name.
export function trackingRowText(label: string, m: PixelMeasurement): string {
  if (m.state === 'events-observed') return `${label}: firing (events: ${m.events.join(', ')})`;
  if (m.state === 'firing') return `${label}: firing`;
  if (m.state === 'present') return `${label}: installed, not observed firing`;
  return `${label}: not detected`;
}

function augmentTrackingChecks(
  engineChecks: CheckResult[],
  tech: TechStackResult | null,
): VerdictCheck[] {
  // Start with what engine.ts caught. Upgrade 3 - tracking checks carry a
  // structured measurement; surface its state in the row text.
  const out: VerdictCheck[] = engineChecks.map((c) => ({
    ok: c.passed,
    text: c.measurement ? trackingRowText(c.label, c.measurement) : c.label,
    reliability: c.reliability,
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
      // A fingerprinted advertising/analytics tag is a real detection - the
      // tag's code is on the page. Presence is assertable.
      out.push({ ok: true, text, reliability: 'verified' });
      seenNames.add(key);
    }
  }

  return out;
}

// ============================================================
// Per-dimension cell builders. Each returns a real reading when data is
// available or a placeholder so the 9-cell grid always fills.
// Canonical headings come from the dim list on the form: D-01..D-09.
// ============================================================

function buildSearchCell(searchBasics: CheckResult[]): VerdictCell {
  if (searchBasics.length === 0) {
    return {
      icon: 'search' as VerdictIcon,
      heading: 'How Google sees you',
      value: 'n/a',
      note: 'Crawl checks did not run. The homepage fetch likely failed before search-hygiene signals could be measured.',
      benchmark: 'Index · unknown',
      benchmarkRight: 'Retry pending',
      checks: [],
    };
  }
  const sb = passCount(searchBasics);
  const gaps = sb.total - sb.passed;
  const robotsBlocked = searchBasics.some(
    (c) => c.id === 'robots' && !c.passed && /block/i.test(c.evidence),
  );
  return {
    icon: 'search' as VerdictIcon,
    heading: 'How Google sees you',
    value: valueStr(sb),
    note: noteFor('crawl-and-schema', sb, 'Crawlable, indexed, canonical, schema present.'),
    benchmark: `Index · ${robotsBlocked ? 'blocked' : 'crawlable'}`,
    benchmarkRight: gaps === 0 ? 'Clean' : `${gaps} gap${gaps === 1 ? '' : 's'}`,
    checks: checksFromCategory(searchBasics),
  };
}

function buildAEOCell(aeo: CheckResult[]): VerdictCell {
  if (aeo.length === 0) {
    return {
      icon: 'spark' as VerdictIcon,
      heading: 'How AI engines cite you',
      value: 'n/a',
      note: 'AEO checks did not run for this scan.',
      benchmark: 'AEO · readiness',
      benchmarkRight: 'Unknown',
      checks: [],
    };
  }
  const aeoPass = passCount(aeo);
  const aeoGap = aeoPass.total - aeoPass.passed;
  return {
    icon: 'spark' as VerdictIcon,
    heading: 'How AI engines cite you',
    value: valueStr(aeoPass),
    note:
      aeoPass.passed === aeoPass.total
        ? 'Every AEO signal we look for is in place. ChatGPT, Claude, Perplexity can read this site.'
        : aeoPass.passed === 0
          ? 'No AEO signals detected. AI engines cannot connect this domain to its services or entity.'
          : `${aeoGap} of ${aeoPass.total} AEO signals missing. Cited competitors fill the gap when prospects ask.`,
    benchmark: 'AEO · readiness',
    benchmarkRight:
      aeoPass.passed === aeoPass.total
        ? 'Ready'
        : aeoPass.passed === 0
          ? 'Not ready'
          : `${aeoGap} of ${aeoPass.total} missing`,
    checks: checksFromCategory(aeo),
  };
}

function placeholderPSI(): VerdictCell {
  return {
    icon: 'bolt' as VerdictIcon,
    heading: 'How fast it loads',
    value: 'n/a',
    note: "PageSpeed didn't return for this scan. Either Google's anonymous quota was exhausted, the site blocked the Lighthouse bot, or the page took longer than 28 seconds. Try again in a few minutes.",
    benchmark: 'PSI · unavailable',
    benchmarkRight: 'Retry pending',
    checks: [],
  };
}

export function buildTrackingCell(
  tracking: CheckResult[],
  enrich?: EnrichmentBundle,
): VerdictCell {
  if (tracking.length === 0) {
    return {
      icon: 'target' as VerdictIcon,
      heading: 'What you measure',
      value: 'n/a',
      note: 'Tracking-pixel checks did not run for this scan.',
      benchmark: 'Pixels · unavailable',
      benchmarkRight: 'Retry pending',
      checks: [],
    };
  }
  const mergedTech = enrich?.techStack
    ? mergeTechResults(enrich.techStack, enrich.techStackRuntime ?? null).merged
    : null;
  const augmentedChecks = augmentTrackingChecks(tracking, mergedTech);

  // Upgrade 3 - summarise from the measured engine checks, honestly. The
  // headless pass is what confirms a pixel actually fired; without it we can
  // only report what the page source shows.
  const measurements = tracking
    .map((c) => c.measurement)
    .filter((m): m is PixelMeasurement => !!m);
  const total = measurements.length;
  const firing = measurements.filter(
    (m) => m.state === 'firing' || m.state === 'events-observed',
  ).length;
  const withEvents = measurements.filter((m) => m.state === 'events-observed').length;
  const installed = measurements.filter((m) => m.state !== 'absent').length;

  if (!enrich?.headless) {
    // No live measurement this scan; report what the page source shows.
    const missing = total - installed;
    return {
      icon: 'target' as VerdictIcon,
      heading: 'What you measure',
      value: `${installed} of ${total}`,
      note:
        installed === 0
          ? 'No tracking tags found in the page source. Live firing was not measured in this scan.'
          : `${installed} of ${total} tracking tags found in the page source. Live firing was not measured in this scan.`,
      benchmark: 'Pixels · static scan',
      benchmarkRight: missing === 0 ? 'All present' : `${missing} missing`,
      checks: augmentedChecks,
    };
  }

  const idle = installed - firing;
  const absent = total - installed;
  return {
    icon: 'target' as VerdictIcon,
    heading: 'What you measure',
    value: `${firing} of ${total}`,
    note:
      firing === total
        ? withEvents > 0
          ? `Every tracker is firing; named events captured on ${withEvents}.`
          : 'Every tracker is firing.'
        : `${firing} of ${total} trackers confirmed firing` +
          (idle > 0 ? `, ${idle} installed but not observed firing` : '') +
          (absent > 0 ? `, ${absent} absent` : '') +
          '.',
    benchmark: 'Pixels · measured live',
    benchmarkRight: firing === total ? 'All firing' : `${total - firing} not firing`,
    checks: augmentedChecks,
  };
}

function placeholderAds(): VerdictCell {
  return {
    icon: 'megaphone' as VerdictIcon,
    heading: 'Ads running today',
    value: 'n/a',
    note:
      'Ad-library probe did not return for this scan. Either SCRAPECREATORS_API_KEY is unset, the rate limit was hit, or none of Meta / Google / LinkedIn knew this domain.',
    benchmark: 'Ad libraries · unavailable',
    benchmarkRight: 'Retry pending',
    checks: [],
  };
}

function buildConversionCell(conversion: CheckResult[]): VerdictCell {
  if (conversion.length === 0) {
    return {
      icon: 'eye' as VerdictIcon,
      heading: 'How visitors convert',
      value: 'n/a',
      note: 'Conversion-path checks did not run for this scan.',
      benchmark: 'Path · unknown',
      benchmarkRight: 'Retry pending',
      checks: [],
    };
  }
  const cp = passCount(conversion);
  const cgap = cp.total - cp.passed;
  return {
    icon: 'eye' as VerdictIcon,
    heading: 'How visitors convert',
    value: valueStr(cp),
    note: noteFor('conversion', cp, 'Clear path, strong CTAs, tappable contact.'),
    benchmark: `Path · ${cgap === 0 ? 'clear' : cgap >= cp.total ? 'blocked' : 'partial'}`,
    benchmarkRight: cgap === 0 ? 'Clear' : `${cgap} gap${cgap === 1 ? '' : 's'}`,
    checks: checksFromCategory(conversion),
  };
}

function placeholderMobile(): VerdictCell {
  return {
    icon: 'phone' as VerdictIcon,
    heading: 'How it behaves on mobile',
    value: 'n/a',
    note: 'Mobile-render checks did not run for this scan.',
    benchmark: '390x844 · unavailable',
    benchmarkRight: 'Retry pending',
    checks: [],
  };
}

function placeholderMail(): VerdictCell {
  return {
    icon: 'mail' as VerdictIcon,
    heading: 'Email reputation',
    value: 'n/a',
    note: 'DoH lookups did not return for this scan. Either Cloudflare 1.1.1.1 was unreachable or the domain has no published mail records.',
    benchmark: 'DoH · unavailable',
    benchmarkRight: 'Retry pending',
    checks: [],
  };
}

function placeholderStack(staticRan: boolean): VerdictCell {
  return {
    icon: 'flag' as VerdictIcon,
    heading: 'The stack you actually run',
    value: 'n/a',
    note: staticRan
      ? 'No technologies detected even after a full pass.'
      : 'Tech-stack fingerprint did not run for this scan.',
    benchmark: staticRan ? '0 categories · verified' : 'Fingerprint · unavailable',
    benchmarkRight: staticRan ? 'Nothing detected' : 'Retry pending',
    checks: [],
  };
}

// ============================================================
// Upgrade 7 - reliability calibration + cross-dimension synthesis
// ============================================================

// A cell is only as assertable as its softest finding.
function rollupReliability(checks: VerdictCheck[]): Reliability {
  let hasInferred = false;
  for (const c of checks) {
    if (c.reliability === 'soft-absence') return 'soft-absence';
    if (c.reliability === 'inferred') hasInferred = true;
  }
  return hasInferred ? 'inferred' : 'verified';
}

// Reliability for an enrichment-cell row that did not come from a tagged
// CheckResult. Speed, mail, ads, and stack are real measurements, real DNS,
// real ad-library hits, and real fingerprint detection - assertable. Mobile
// is verified when a real 390x844 render ran; its static fallback
// false-negatives, so a failing static row is soft.
function defaultRowReliability(icon: VerdictIcon, c: VerdictCheck, headlessRan: boolean): Reliability {
  if (icon === 'phone') return headlessRan || c.ok ? 'verified' : 'soft-absence';
  return 'verified';
}

// Fill reliability on every cell check - category cells already carry it from
// their CheckResults; enrichment cells get the icon-based default - and roll
// each cell up to one calibration tag.
function calibrateCells(cells: VerdictCell[], headlessRan: boolean): VerdictCell[] {
  return cells.map((cell) => {
    if (cell.checks.length === 0) return cell; // placeholder / not-measured cell
    const checks: VerdictCheck[] = cell.checks.map((c) =>
      c.reliability ? c : { ...c, reliability: defaultRowReliability(cell.icon, c, headlessRan) },
    );
    return { ...cell, checks, reliability: rollupReliability(checks) };
  });
}

function iconForCategory(category: CheckResult['category']): VerdictIcon {
  switch (category) {
    case 'aeo':
      return 'spark';
    case 'tracking':
      return 'target';
    case 'conversion':
      return 'eye';
    default:
      return 'search'; // crawl, schema, meta
  }
}

// The cross-dimension synthesis the LLM hero reads as its brief. Deterministic
// and rule-based: it correlates the dimensions and picks the systemic headline
// so the hero writes prose from an honest, already-connected read instead of
// guessing the diagnosis itself.
export function synthesizeDiagnosis(
  audit: AuditResult,
  enrich: EnrichmentBundle | undefined,
  cells: VerdictCell[],
): Synthesis {
  const ads = enrich?.ads;
  const adsTotal = ads ? (ads.metaActive ?? 0) + (ads.googleActive ?? 0) + (ads.linkedinActive ?? 0) : 0;
  const adsRunning = adsTotal > 0;
  const adWord = adsTotal === 1 ? 'ad' : 'ads';
  const ps = enrich?.pageSpeed;
  const speedPoor = ps?.band === 'poor';
  const noDmarc = enrich?.deliverability?.dmarcPresent === false;

  // Conversion + tracking gaps - the failures that cost paid traffic money.
  const adGaps = audit.checks.filter(
    (c) => !c.passed && (c.category === 'conversion' || c.category === 'tracking'),
  );
  const adGapsHardFact = adGaps.length > 0 && adGaps.every((c) => c.reliability === 'verified');
  const adGapWord = adGaps.length === 1 ? 'gap' : 'gaps';

  const crossSignals: CrossSignal[] = [];
  if (adsRunning && speedPoor) {
    crossSignals.push({
      key: 'ads-running-slow-page',
      detail: `Running ${adsTotal} paid ${adWord} into a homepage that loads slowly on mobile (LCP ${fmtMs(ps!.lcpMs)}). Paid clicks bounce before the offer renders.`,
      reliability: 'verified',
    });
  }
  if (adsRunning && adGaps.length > 0) {
    crossSignals.push({
      key: 'ads-running-conversion-gaps',
      detail: `Running ${adsTotal} paid ${adWord}, but the page paid traffic lands on has ${adGaps.length} conversion or tracking ${adGapWord}.`,
      reliability: adGapsHardFact ? 'verified' : 'soft-absence',
    });
  }
  if (speedPoor && !adsRunning) {
    crossSignals.push({
      key: 'slow-page',
      detail: `The homepage loads slowly on mobile (LCP ${fmtMs(ps!.lcpMs)}), the point most visitors decide to stay or leave.`,
      reliability: 'verified',
    });
  }
  if (noDmarc) {
    crossSignals.push({
      key: 'no-dmarc',
      detail: 'The sending domain has no DMARC record, so outbound mail risks the spam folder.',
      reliability: 'verified',
    });
  }

  // primaryIssue - the systemic headline, in priority order.
  let primaryIssue: Synthesis['primaryIssue'] = null;
  if (adsRunning && speedPoor) {
    primaryIssue = {
      icon: 'bolt',
      dimension: 'Page speed',
      summary: `Paid traffic is landing on a homepage that takes too long to render on mobile (LCP ${fmtMs(ps!.lcpMs)}).`,
      reliability: 'verified',
    };
  } else if (adsRunning && adGaps.length > 0) {
    primaryIssue = {
      icon: 'eye',
      dimension: 'Conversion path',
      summary: `Paid traffic is landing on a page with ${adGaps.length} measurable conversion or tracking ${adGapWord}.`,
      reliability: adGapsHardFact ? 'verified' : 'soft-absence',
    };
  } else if (noDmarc) {
    primaryIssue = {
      icon: 'mail',
      dimension: 'Email reputation',
      summary: 'The sending domain is missing DMARC; outbound mail is at deliverability risk.',
      reliability: 'verified',
    };
  } else if (speedPoor) {
    primaryIssue = {
      icon: 'bolt',
      dimension: 'Page speed',
      summary: `The homepage loads slowly on mobile (LCP ${fmtMs(ps!.lcpMs)}).`,
      reliability: 'verified',
    };
  } else {
    // Fall back to the worst failing audit check, verified failures first.
    const worst = audit.checks
      .filter((c) => !c.passed)
      .sort((a, b) => {
        const ra = a.reliability === 'verified' ? 1 : 0;
        const rb = b.reliability === 'verified' ? 1 : 0;
        if (ra !== rb) return rb - ra;
        return b.weight - a.weight;
      })[0];
    if (worst) {
      primaryIssue = {
        icon: iconForCategory(worst.category),
        dimension: worst.label,
        summary: worst.finding,
        reliability: worst.reliability,
      };
    }
  }

  // Calibration totals across every calibrated cell check.
  let verifiedCount = 0;
  let softCount = 0;
  for (const cell of cells) {
    for (const c of cell.checks) {
      if (c.reliability === 'verified') verifiedCount++;
      else if (c.reliability) softCount++;
    }
  }

  return { primaryIssue, crossSignals, verifiedCount, softCount };
}

export function buildMemoFromAudit(audit: AuditResult, enrich?: EnrichmentBundle): Memo {
  const slug = generateSlug(audit.hostname);

  // Two distinct cells: "How Google sees you" (search basics — crawl,
  // schema, meta) and "How AI engines see you" (AEO — llms.txt, AI-bot
  // robots policy, structured-data depth). Splitting them surfaces the
  // AEO signal cleanly instead of burying it inside generic search hygiene.
  const searchBasics = audit.checks.filter(
    (c) => c.category === 'crawl' || c.category === 'schema' || c.category === 'meta',
  );
  const aeo = audit.checks.filter((c) => c.category === 'aeo');
  const tracking = audit.checks.filter((c) => c.category === 'tracking');
  const conversion = audit.checks.filter((c) => c.category === 'conversion');

  // The result grid ALWAYS renders 9 cells in canonical D-01..D-09 order.
  // Each builder returns a real reading when data exists or a placeholder
  // cell so the 3x3 grid never collapses to 8.
  const verdictCells: VerdictCell[] = [
    buildSearchCell(searchBasics),
    buildAEOCell(aeo),
    enrich?.pageSpeed ? speedCellFromPsi(enrich.pageSpeed) : placeholderPSI(),
    buildTrackingCell(tracking, enrich),
    enrich?.ads
      ? adsCellFromResult(enrich.ads, enrich?.landing ?? null, enrich?.pageSpeed?.performanceScore ?? null)
      : placeholderAds(),
    buildConversionCell(conversion),
    enrich?.mobile
      ? mobileCellFromResult(enrich.mobile, enrich?.headless ?? null)
      : placeholderMobile(),
    enrich?.deliverability ? mailCellFromResult(enrich.deliverability) : placeholderMail(),
    enrich?.techStack && enrich.techStack.total > 0
      ? techStackCellFromResult(enrich.techStack, enrich.techStackRuntime)
      : placeholderStack(!!enrich?.techStack),
  ];

  // Upgrade 7 - calibrate every cell with a reliability tag, then synthesize
  // the cross-dimension diagnosis the LLM hero reads as its brief.
  const trimmedCells = calibrateCells(verdictCells, !!enrich?.headless);
  const synthesis = synthesizeDiagnosis(audit, enrich, trimmedCells);

  // Ranked fixes: enrichment-driven priorities first (page speed, DMARC, viewport
  // are the highest-leverage wins when broken), then top failing audit checks.
  //
  // Ad-spending operators are different. When the operator is actively running
  // paid ads, conversion gaps and pixel gaps cost real money per click - they
  // outweigh /llms.txt or schema fixes that only matter for organic traffic.
  // Boost conversion + tracking categories above everything else in that case
  // so the Top 3 Fixes reflect the operator's actual exposure.
  const adsRunning =
    !!(enrich?.ads &&
      ((enrich.ads.metaActive ?? 0) +
        (enrich.ads.googleActive ?? 0) +
        (enrich.ads.linkedinActive ?? 0)) > 0);
  const AD_OPERATOR_PRIORITY: ReadonlySet<CheckResult['category']> = new Set([
    'conversion',
    'tracking',
  ]);
  const failed = audit.checks
    .filter((c) => !c.passed)
    .sort((a, b) => {
      if (adsRunning) {
        const aBoost = AD_OPERATOR_PRIORITY.has(a.category) ? 100 : 0;
        const bBoost = AD_OPERATOR_PRIORITY.has(b.category) ? 100 : 0;
        if (aBoost !== bBoost) return bBoost - aBoost;
      }
      return b.weight - a.weight;
    });
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

  // Cover italic clause: short and punchy. This text drops into the H1 at
  // ~96px italic serif, so multi-sentence prose wraps into a wall. Keep it
  // to one tight clause - the dek and observation carry the longer story.
  // For ad-spending operators, conversion + tracking gaps land harder than
  // generic "X ads running" - those gaps are where paid clicks bleed.
  const adConvGapCount = adsRunning
    ? audit.checks.filter(
        (c) => !c.passed && AD_OPERATOR_PRIORITY.has(c.category),
      ).length
    : 0;
  // Default: just the band label as a one-word verdict.
  let coverItalic = `${audit.bandLabel}.`;
  if (enrich?.pageSpeed?.band === 'poor') {
    coverItalic = `Mobile load ${fmtMs(enrich.pageSpeed.lcpMs)}: bleeding paid clicks.`;
  } else if (adsRunning && adConvGapCount > 0) {
    const total = (enrich!.ads!.metaActive ?? 0) + (enrich!.ads!.googleActive ?? 0) + (enrich!.ads!.linkedinActive ?? 0);
    coverItalic = `${total} paid ${total === 1 ? 'ad' : 'ads'}, ${adConvGapCount} conversion ${adConvGapCount === 1 ? 'gap' : 'gaps'}.`;
  } else if (enrich?.deliverability?.dmarcPresent === false) {
    coverItalic = `No DMARC: outbound risks the spam folder.`;
  } else if (enrich?.ads && (enrich.ads.metaActive ?? 0) + (enrich.ads.googleActive ?? 0) > 0) {
    const total = (enrich.ads.metaActive ?? 0) + (enrich.ads.googleActive ?? 0);
    coverItalic = `${total} paid ${total === 1 ? 'ad' : 'ads'} running today.`;
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
  } else if (adsRunning && adConvGapCount > 0) {
    const totalAds = (enrich!.ads!.metaActive ?? 0) + (enrich!.ads!.googleActive ?? 0) + (enrich!.ads!.linkedinActive ?? 0);
    observation = `${audit.hostname} is spending on ${totalAds} active paid ${totalAds === 1 ? 'ad' : 'ads'}, but the conversion and pixel side of the funnel has ${adConvGapCount} measurable ${adConvGapCount === 1 ? 'gap' : 'gaps'}. <strong>That is paid traffic landing on a leaky page.</strong> The fixes above close it. Schema and llms.txt matter for the organic side; paid clicks need the conversion path tight first.`;
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
    synthesis,
    verdictCells: trimmedCells,
    rankedFixes,
    personalObservation: { text: observation },
  };

  return memo;
}

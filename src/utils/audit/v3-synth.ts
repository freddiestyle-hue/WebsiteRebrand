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
import type { HeadlessResult } from './headless-check';

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
    heading: 'Ads you are running',
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
      ? 'No technologies detected even after a full headless browser pass.'
      : 'No technologies detected from the static HTML scan. Runtime JS may be hiding them.';
  } else if (hasRuntime && runtimeOnly.size > 0) {
    note = `${t.total} technologies detected (${runtimeOnly.size} only visible after JS executed — those are runtime-injected, the rest were in static HTML).`;
  } else {
    note = `${t.total} technologies detected across ${Object.keys(t.byCategory).length} categories.`;
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
    heading: 'Tech stack you are running',
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

  const verdictCells: VerdictCell[] = [];

  if (searchBasics.length > 0) {
    const sb = passCount(searchBasics);
    const gaps = sb.total - sb.passed;
    // Detect crawl-block specifically (robots disallowing AI bots is the
    // worst-case for INDEX status).
    const robotsBlocked = searchBasics.some(
      (c) => c.id === 'robots' && !c.passed && /block/i.test(c.evidence),
    );
    verdictCells.push({
      icon: 'search' as VerdictIcon,
      heading: 'How Google sees you',
      value: valueStr(sb),
      note: noteFor(
        'crawl-and-schema',
        sb,
        'Crawlable, indexed, canonical, schema present.',
      ),
      benchmark: `Index · ${robotsBlocked ? 'blocked' : 'crawlable'}`,
      benchmarkRight: gaps === 0 ? 'Clean' : `${gaps} gap${gaps === 1 ? '' : 's'}`,
      checks: checksFromCategory(searchBasics),
    });
  }

  if (aeo.length > 0) {
    const aeoPass = passCount(aeo);
    const aeoGap = aeoPass.total - aeoPass.passed;
    verdictCells.push({
      icon: 'spark' as VerdictIcon,
      heading: 'How AI engines see you',
      value: valueStr(aeoPass),
      note:
        aeoPass.passed === aeoPass.total
          ? 'Every AEO signal we look for is in place. ChatGPT, Claude, Perplexity can read this site.'
          : aeoPass.passed === 0
            ? 'No AEO signals detected. AI engines cannot connect this domain to its services or entity.'
            : `${aeoPass.total - aeoPass.passed} of ${aeoPass.total} AEO signals missing. Cited competitors fill the gap when prospects ask.`,
      benchmark: 'AEO · readiness',
      benchmarkRight:
        aeoPass.passed === aeoPass.total
          ? 'Ready'
          : aeoPass.passed === 0
            ? 'Not ready'
            : `${aeoGap} of ${aeoPass.total} missing`,
      checks: checksFromCategory(aeo),
    });
  }

  if (enrich?.pageSpeed) {
    verdictCells.push(speedCellFromPsi(enrich.pageSpeed));
  } else if (enrich) {
    // PSI returned null (quota / timeout / network). Still emit a cell so the
    // 9-grid stays intact and the operator sees the dimension was attempted.
    verdictCells.push({
      icon: 'bolt' as VerdictIcon,
      heading: 'How fast it loads',
      value: 'n/a',
      note: "PageSpeed didn't return for this scan. Either Google's anonymous quota was exhausted, the site blocked the Lighthouse bot, or the page took longer than 28 seconds. Try again in a few minutes.",
      benchmark: 'PSI · unavailable',
      benchmarkRight: 'Retry pending',
      checks: [],
    });
  }

  if (tracking.length > 0) {
    // Use merged static+runtime tech stack so GTM-injected pixels show up.
    const mergedTech = enrich?.techStack
      ? mergeTechResults(enrich.techStack, enrich.techStackRuntime ?? null).merged
      : null;
    const augmentedChecks = augmentTrackingChecks(tracking, mergedTech);
    // Recompute passed count to include fingerprint-detected pixels (always
    // "passed" = "detected" since they're proof of presence, not absence).
    const passedCount = augmentedChecks.filter((c) => c.ok).length;
    const totalCount = augmentedChecks.length;
    const gap = totalCount - passedCount;
    const hasRuntime = !!enrich?.techStackRuntime;
    verdictCells.push({
      icon: 'target' as VerdictIcon,
      heading: 'What you measure',
      value: `${passedCount} of ${totalCount}`,
      note:
        totalCount === passedCount
          ? 'Every tracker we look for is firing.'
          : `${totalCount - passedCount} of ${totalCount} measurement gaps.`,
      benchmark: hasRuntime ? 'Pixels · runtime + static' : 'Pixels · static',
      benchmarkRight: gap === 0 ? 'All firing' : `${gap} gap${gap === 1 ? '' : 's'}`,
      checks: augmentedChecks,
    });
  }

  if (enrich?.ads) {
    verdictCells.push(adsCellFromResult(enrich.ads));
  } else if (enrich) {
    // Ad Library probe returned null (no API key, rate limit, or
    // unsupported domain). Same pattern as the PSI placeholder so the
    // 9-cell grid stays intact rather than collapsing to 8.
    verdictCells.push({
      icon: 'megaphone' as VerdictIcon,
      heading: 'Ads you are running',
      value: 'n/a',
      note:
        "Ad-library probe did not return for this scan. Either SCRAPECREATORS_API_KEY is unset, the rate limit was hit, or none of Meta / Google / LinkedIn knew this domain. Re-run in a few minutes.",
      benchmark: 'Ad libraries · unavailable',
      benchmarkRight: 'Retry pending',
      checks: [],
    });
  }

  if (conversion.length > 0) {
    const cp = passCount(conversion);
    const cgap = cp.total - cp.passed;
    verdictCells.push({
      icon: 'eye' as VerdictIcon,
      heading: 'How visitors convert',
      value: valueStr(cp),
      note: noteFor('conversion', cp, 'Clear path, strong CTAs, tappable contact.'),
      benchmark: `Path · ${cgap === 0 ? 'clear' : cgap >= cp.total ? 'blocked' : 'partial'}`,
      benchmarkRight: cgap === 0 ? 'Clear' : `${cgap} gap${cgap === 1 ? '' : 's'}`,
      checks: checksFromCategory(conversion),
    });
  }

  if (enrich?.mobile) {
    verdictCells.push(mobileCellFromResult(enrich.mobile, enrich?.headless ?? null));
  }

  if (enrich?.deliverability) {
    verdictCells.push(mailCellFromResult(enrich.deliverability));
  }

  if (enrich?.techStack && enrich.techStack.total > 0) {
    verdictCells.push(techStackCellFromResult(enrich.techStack, enrich.techStackRuntime));
  }

  // Pad if under the 3-cell minimum (only happens on heavy fetch failure)
  while (verdictCells.length < 3) {
    verdictCells.push({
      icon: 'flag' as VerdictIcon,
      heading: 'Not measured',
      value: 'n/a',
      note: 'This dimension is not part of the in-browser audit.',
      benchmark: 'Skipped',
      benchmarkRight: 'n/a',
      checks: [],
    });
  }

  // Trim if over the 10-cell maximum (shouldn't happen with current cells, but safe)
  const trimmedCells = verdictCells.slice(0, 10);

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
    verdictCells: trimmedCells,
    rankedFixes,
    personalObservation: { text: observation },
  };

  return memo;
}

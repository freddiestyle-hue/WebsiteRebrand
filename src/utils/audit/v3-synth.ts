// Rule-based synthesis: maps AuditResult → v3 Memo schema.
//
// The "real" v3 memo (the kind that lands at /audit/p/{slug} for cold-DM
// targets) is synthesized by Codex from an enriched record that includes
// signals we cannot get from a 10-second browser audit: ad activity from
// Meta Ad Library, PageSpeed Insights, DNS deliverability records, AI
// citation probes, benchmark percentile against an industry cohort.
//
// This file produces a degraded-but-still-useful v3 memo from JUST the
// in-browser audit. The verdict cells we can compute honestly are:
//   - "How Google sees you" (crawl + schema checks)
//   - "What you measure" (tracking checks)
//   - "How visitors convert" (conversion checks)
//   - "Brand presence" (meta tags, social cards)
//   - "AI discoverability" (AEO checks)
//
// We can't show ads, real performance numbers, mobile rendering, or AI
// citation probes here — those need API keys and 30+ seconds. We surface
// that gap honestly in the personal observation paragraph.

import type { AuditResult, CheckResult } from './engine';
import type { Memo, VerdictCell, RankedFix, VerdictIcon } from './memo-schema';
import { MEMO_SCHEMA_VERSION } from './memo-schema';
import { generateSlug } from './slug';

function passCount(checks: CheckResult[]): { passed: number; total: number } {
  const total = checks.length;
  const passed = checks.filter((c) => c.passed).length;
  return { passed, total };
}

function valueStr({ passed, total }: { passed: number; total: number }): string {
  if (total === 0) return 'n/a';
  return `${passed} of ${total}`;
}

function noteFor(label: string, { passed, total }: { passed: number; total: number }, ifAll: string): string {
  if (total === 0) return `Not measured in this scan.`;
  if (passed === total) return ifAll;
  const gap = total - passed;
  return `${gap} of ${total} ${label} ${gap === 1 ? 'gap' : 'gaps'}.`;
}

function checksFromCategory(checks: CheckResult[]): Array<{ ok: boolean; text: string }> {
  return checks.map((c) => ({ ok: c.passed, text: c.label }));
}

function effortFor(check: CheckResult): 'low' | 'med' | 'high' {
  // Higher weight checks tend to be heavier lifts in practice.
  if (check.weight >= 3) return 'med';
  return 'low';
}

function impactFor(check: CheckResult): 'low' | 'med' | 'high' {
  if (check.weight >= 3) return 'high';
  if (check.weight === 2) return 'med';
  return 'low';
}

function fixWhat(check: CheckResult): string {
  // Capitalize and convert the audit label into an imperative-ish "what" line.
  const label = check.label.trim();
  return label.endsWith('.') ? label : `${label}.`;
}

function fixWhy(check: CheckResult): string {
  // The audit engine already writes a useful "finding" paragraph for each
  // failed check, so we reuse it verbatim. It's already in operator voice.
  return check.finding;
}

export function buildMemoFromAudit(audit: AuditResult): Memo {
  const slug = generateSlug(audit.hostname);

  const crawl = audit.checks.filter((c) => c.category === 'crawl' || c.category === 'schema');
  const meta = audit.checks.filter((c) => c.category === 'meta');
  const aeo = audit.checks.filter((c) => c.category === 'aeo');
  const tracking = audit.checks.filter((c) => c.category === 'tracking');
  const conversion = audit.checks.filter((c) => c.category === 'conversion');

  const verdictCells: VerdictCell[] = [];

  if (crawl.length > 0) {
    verdictCells.push({
      icon: 'search' as VerdictIcon,
      heading: 'How Google sees you',
      value: valueStr(passCount(crawl)),
      note: noteFor('crawl-and-schema', passCount(crawl), 'Crawlable, indexed, schema present.'),
      benchmark: null,
      checks: checksFromCategory(crawl),
    });
  }

  if (tracking.length > 0) {
    verdictCells.push({
      icon: 'target' as VerdictIcon,
      heading: 'What you measure',
      value: valueStr(passCount(tracking)),
      note: noteFor('tracking', passCount(tracking), 'Full conversion stack firing.'),
      benchmark: null,
      checks: checksFromCategory(tracking),
    });
  }

  if (conversion.length > 0) {
    verdictCells.push({
      icon: 'megaphone' as VerdictIcon,
      heading: 'How visitors convert',
      value: valueStr(passCount(conversion)),
      note: noteFor('conversion', passCount(conversion), 'Clear path, strong CTAs, tappable contact.'),
      benchmark: null,
      checks: checksFromCategory(conversion),
    });
  }

  if (meta.length > 0) {
    verdictCells.push({
      icon: 'eye' as VerdictIcon,
      heading: 'Brand presence',
      value: valueStr(passCount(meta)),
      note: noteFor('meta-tag', passCount(meta), 'Title, description, social cards all set.'),
      benchmark: null,
      checks: checksFromCategory(meta),
    });
  }

  if (aeo.length > 0) {
    verdictCells.push({
      icon: 'spark' as VerdictIcon,
      heading: 'AI discoverability',
      value: valueStr(passCount(aeo)),
      note: noteFor('AEO', passCount(aeo), 'Built for AI engine consumption.'),
      benchmark: null,
      checks: checksFromCategory(aeo),
    });
  }

  // The minimum is 3 cells. If fewer (unusual — only if the engine returned a
  // very narrow result set), pad with a placeholder so the schema validates.
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

  // Ranked fixes: take the top failing checks by weight, max 3, min 1.
  const failed = audit.checks.filter((c) => !c.passed).sort((a, b) => b.weight - a.weight);
  let rankedFixes: RankedFix[];
  if (failed.length === 0) {
    rankedFixes = [
      {
        rank: 1,
        what: 'Keep doing what you are doing.',
        why: 'Every check this scan can measure is passing. The next move is signals this audit cannot see: ads, page speed, AI citation, deliverability. Run the full memo pipeline for a real prospect read.',
        effort: 'low',
        impact: 'low',
      },
    ];
  } else {
    rankedFixes = failed.slice(0, 3).map((c, i) => ({
      rank: i + 1,
      what: fixWhat(c),
      why: fixWhy(c),
      effort: effortFor(c),
      impact: impactFor(c),
    }));
  }

  const dekParts: string[] = [];
  dekParts.push(
    `This is a live in-browser scan. It checks crawlability, schema, tracking, meta tags, and AEO signals.`,
  );
  dekParts.push(
    `It does not see ads, page speed, mobile rendering, AI citations, or email deliverability. Those need API keys and live in the full pipeline.`,
  );

  const personalObservationText =
    failed.length === 0
      ? `Every check this audit can run is passing, which is rare. The next layer is the part we did not measure here: are your ads landing on slow pages, is GA4 wired to a conversion event, do ChatGPT and Perplexity name you when their users ask for what you sell. Those are the questions worth answering next.`
      : `${audit.hostname} fails ${failed.length} ${failed.length === 1 ? 'check' : 'checks'} this scan can measure. The top three are above. <strong>What this scan does not see matters more.</strong> Page speed on the ad landing page, whether GA4 is connected to a conversion event, what AI engines say when their users ask about your service. Those are the questions worth answering next, and they need the full memo pipeline.`;

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
      italic: `${audit.bandLabel}. ${audit.bandKicker}`,
      dek: dekParts.join(' '),
    },
    benchmark: undefined,
    screenshots: undefined,
    verdictCells,
    rankedFixes,
    personalObservation: { text: personalObservationText },
  };

  return memo;
}

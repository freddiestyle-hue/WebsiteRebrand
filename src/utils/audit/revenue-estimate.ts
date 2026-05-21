// Deterministic, ranged revenue-impact estimate for the teardown hero.
//
// D4-A: the estimate is computed here, outside the LLM, and passed to the hero
// prompt as REVENUE_ESTIMATE. The LLM never does its own arithmetic - it may
// only cite figures this module produced. We never know a prospect's ad spend
// or traffic, so the estimate is always a proportion, never a dollar amount,
// and always a range, never a point. Each line states the assumption it rests
// on, so the page can show its work.

import type { Memo, VerdictCell, VerdictIcon } from './memo-schema';

// Google's "good" mobile LCP threshold. Delay is measured from here.
const LCP_GOOD_THRESHOLD_S = 2.5;
// The audit's own stated heuristic ("~7% conversion drop per second of delay",
// printed in the page-speed cell note) widened into a 6-8% band, so the
// estimate is a defensible range rather than false-precision.
const DROP_PER_SECOND_LO = 6;
const DROP_PER_SECOND_HI = 8;
// Only surface a speed estimate once the modelled loss clears this floor of
// seconds-over-threshold; below it the leak is real but too small to lead on.
const MIN_SECONDS_OVER = 1;

function cellByIcon(memo: Memo): Map<VerdictIcon, VerdictCell> {
  const m = new Map<VerdictIcon, VerdictCell>();
  for (const c of memo.verdictCells) m.set(c.icon, c);
  return m;
}

// The megaphone cell records whether the prospect buys traffic. Mirrors the
// detection in pick-hero.ts: positive ad language, explicit negatives excluded.
function adsRunning(cells: Map<VerdictIcon, VerdictCell>): boolean {
  const ads = cells.get('megaphone');
  if (!ads) return false;
  const blob = `${ads.value} ${ads.note}`.toLowerCase();
  if (/no active|none|not running|0 ads|no ads|nothing/.test(blob)) return false;
  return /\bads?\b|campaign|spending|live|running|active/.test(blob);
}

// Mobile LCP in seconds from the page-speed (bolt) cell. v3-synth writes it as
// "4.6s LCP" in the note and "paints in 4.6s" in a check. Returns null when no
// LCP is stated - the PSI run failed, or the page is fast enough not to flag.
export function lcpSeconds(cell: VerdictCell | undefined): number | null {
  if (!cell) return null;
  const corpus = `${cell.note} ${cell.checks.map((c) => c.text).join(' ')}`;
  const m =
    corpus.match(/(\d+(?:\.\d+)?)\s*s\s+lcp/i) ||
    corpus.match(/paints?\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 60 ? n : null;
}

// Failed vs total conversion-path checks on the conversion (eye) cell.
function conversionGaps(cell: VerdictCell | undefined): { failed: number; total: number } | null {
  if (!cell || !cell.checks.length) return null;
  return {
    failed: cell.checks.filter((c) => !c.ok).length,
    total: cell.checks.length,
  };
}

// Round to a whole percent, clamped to a sane 1-95 band.
function pct(n: number): number {
  return Math.max(1, Math.min(95, Math.round(n)));
}

// Build the REVENUE_ESTIMATE string for one prospect, or null when the audit
// gives no safe basis (the prompt then reads "Not available.").
export function buildRevenueEstimate(memo: Memo): string | null {
  const cells = cellByIcon(memo);
  const ads = adsRunning(cells);

  // Speed-driven leak. Uses the audit's own "~7% conversion drop per second of
  // delay" heuristic - the same rule already printed in the page-speed cell -
  // widened to a 6-8% band against Google's 2.5s LCP threshold.
  const lcp = lcpSeconds(cells.get('bolt'));
  if (lcp != null) {
    const secondsOver = lcp - LCP_GOOD_THRESHOLD_S;
    if (secondsOver >= MIN_SECONDS_OVER) {
      const lo = pct(secondsOver * DROP_PER_SECOND_LO);
      const hi = pct(secondsOver * DROP_PER_SECOND_HI);
      const audience = ads ? 'the paid clicks landing on it' : 'mobile visitors';
      const tail = ads
        ? ` On paid traffic that is ${lo} to ${hi}% of the ad budget spent reaching a page no one waits for.`
        : '';
      return (
        `Assumption: mobile load is ${lcp}s against Google's 2.5s "good" threshold, ` +
        `and conversion drops roughly 6 to 8% for every second over it. ` +
        `That models a ${lo} to ${hi}% loss of conversion among ${audience}, from load time alone.${tail}`
      );
    }
  }

  // Conversion-driven leak. No traffic data means no safe way to size the
  // visitor loss, so this reports the hard proportion only: how much of the
  // page's conversion setup is in place.
  const conv = conversionGaps(cells.get('eye'));
  if (conv && conv.failed > 0) {
    const intact = pct(((conv.total - conv.failed) / conv.total) * 100);
    const audience = ads ? 'the paid clicks landing on it' : 'visitors who arrive ready to act';
    return (
      `Assumption: ${conv.failed} of ${conv.total} conversion signals on the page are missing or buried, ` +
      `so it is running at about ${intact}% of a complete conversion setup. ` +
      `Without traffic data there is no safe way to size the visitor loss in dollars, ` +
      `but ${audience} are meeting a page built to convert at a fraction of its capacity.`
    );
  }

  return null;
}

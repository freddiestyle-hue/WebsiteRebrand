// Locked-card observation builder.
//
// Each non-hero verdict cell renders as: dimension name + the real measured
// value (proof the scan ran) + a one-line observation with one consequence
// phrase redacted. The redaction is a true bar — no hidden text ships in the
// DOM, so inspect-element and screen readers cannot defeat it.
//
// pre/post fragments are authored per dimension. The redaction WIDTH derives
// from the prospect's own failing-check count, so the bar varies per company
// rather than being a fixed decorative element.
//
// Design provenance: the redaction mechanic is lifted from the V4 Hybrid
// teardown mock; the case-file / "classified" costume around it was dropped
// per the red-team pass (voice.md: senior operator, not a marketer).

import type { VerdictCell } from './memo-schema';

export interface LockedObservation {
  pre: string;
  redactCh: number;
  post: string;
}

// pre / post fragments per dimension icon. The redacted span sits between them
// and withholds the specific consequence — the thing the prospect needs the
// call to learn. The measured value is shown separately and stays visible.
const TEMPLATES: Record<string, { pre: string; post: string }> = {
  search: {
    pre: 'The crawl found ',
    post: ' on the page deciding how Google reads you. The cause is not the algorithm.',
  },
  spark: {
    pre: 'Ask the category question and the model reaches for ',
    post: ' before it ever names you.',
  },
  bolt: {
    pre: 'Largest content paint clocks ',
    post: ' on a mid-tier phone. Google calls 2.5 seconds the bar.',
  },
  target: {
    pre: 'You log clicks. You do not log ',
    post: ', the one event that predicts revenue best in this vertical.',
  },
  megaphone: {
    pre: 'Of the ads in flight, ',
    post: ' route to the page named in the hero finding. The spend is real money.',
  },
  eye: {
    pre: 'Visitors land and leave because of ',
    post: '. It reads as one fix, not five.',
  },
  phone: {
    pre: 'On a real iPhone render, the primary action sits ',
    post: ' out of thumb reach. Tap rate halves at the second scroll.',
  },
  mail: {
    pre: 'The sending domain is missing ',
    post: '. Replies are landing in Promotions, not the inbox.',
  },
  flag: {
    pre: 'Of the tools loading on every page, ',
    post: ' duplicate work you already pay for once.',
  },
};

const FALLBACK = {
  pre: 'The scan surfaced ',
  post: ' worth thirty minutes on the call.',
};

// Redaction width in ch units. Anchored to the prospect's failing-check count
// so a site with more gaps shows a wider bar. Clamped to a believable range.
function deriveRedactWidth(cell: VerdictCell): number {
  const fails = (cell.checks ?? []).filter((c) => !c.ok).length;
  return Math.max(6, Math.min(16, Math.round(6 + fails * 1.7)));
}

export function buildLockedObservation(cell: VerdictCell): LockedObservation {
  const tpl = TEMPLATES[cell.icon] ?? FALLBACK;
  return { pre: tpl.pre, redactCh: deriveRedactWidth(cell), post: tpl.post };
}

// Short dimension label + the unit label shown under the big value.
const META: Record<string, { shortLabel: string; valueLabel: string }> = {
  search: { shortLabel: 'Search visibility', valueLabel: 'Pages indexed' },
  spark: { shortLabel: 'AI citation', valueLabel: 'Models reached' },
  bolt: { shortLabel: 'Page speed', valueLabel: 'Lighthouse · mobile' },
  target: { shortLabel: 'Measurement', valueLabel: 'Events tracked' },
  megaphone: { shortLabel: 'Ads in flight', valueLabel: 'Active campaigns' },
  eye: { shortLabel: 'Conversion path', valueLabel: 'Conversion signals' },
  phone: { shortLabel: 'Mobile', valueLabel: 'UX issues' },
  mail: { shortLabel: 'Email reputation', valueLabel: 'Auth records' },
  flag: { shortLabel: 'Stack', valueLabel: 'Tools detected' },
  bar: { shortLabel: 'Measurement', valueLabel: 'Signals' },
  clock: { shortLabel: 'Cadence', valueLabel: 'Checks' },
};

export function lockedMeta(icon: string): { shortLabel: string; valueLabel: string } {
  return META[icon] ?? { shortLabel: 'Finding', valueLabel: 'Reading' };
}

// Tone for the big value: halt (red) = severe, warn (amber) = gaps present,
// none (ink) = a neutral count. Ads and stack are counts, never alarm-toned.
export type LockedTone = 'halt' | 'warn' | 'none';

export function deriveTone(cell: VerdictCell): LockedTone {
  if (cell.icon === 'megaphone' || cell.icon === 'flag') return 'none';
  const value = cell.value ?? '';
  // Page speed: a 0-100 score.
  const speed = value.match(/(\d+)\s*\/\s*100/);
  if (speed) {
    const n = Number(speed[1]);
    return n < 50 ? 'halt' : n < 90 ? 'warn' : 'none';
  }
  // "X of Y" / "X / Y": half or worse is halt, any gap is warn.
  const ratio = value.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);
  if (ratio) {
    const r = Number(ratio[1]) / Math.max(Number(ratio[2]), 1);
    return r <= 0.5 ? 'halt' : r < 1 ? 'warn' : 'none';
  }
  // "N issues": any issue is warn, three or more is halt.
  const issues = value.match(/(\d+)\s*issue/i);
  if (issues) {
    const n = Number(issues[1]);
    return n === 0 ? 'none' : n >= 3 ? 'halt' : 'warn';
  }
  // Fallback: passing-check ratio.
  const checks = cell.checks ?? [];
  if (checks.length) {
    const r = checks.filter((c) => c.ok).length / checks.length;
    return r <= 0.5 ? 'halt' : r < 1 ? 'warn' : 'none';
  }
  return 'none';
}

// Hero-dimension-aware "why this one first" line. The V4 mock hardcoded a
// conversion-specific line; that is a lie when the hero is email or speed.
const WHY_FIRST: Record<string, string> = {
  eye: 'Why this one first: every other finding routes back through this page.',
  conversion: 'Why this one first: every other finding routes back through this page.',
  pagespeed: 'Why this one first: speed is the tax every other finding pays on the way in.',
  bolt: 'Why this one first: speed is the tax every other finding pays on the way in.',
  seo: 'Why this one first: if Google reads you wrong, the other eight never get traffic to fail at.',
  search: 'Why this one first: if Google reads you wrong, the other eight never get traffic to fail at.',
  aeo: 'Why this one first: AI search is where the next cohort of buyers starts, and you are not in the answer.',
  spark: 'Why this one first: AI search is where the next cohort of buyers starts, and you are not in the answer.',
  email: 'Why this one first: if mail does not land, every follow-up in the other eight is shouting into a spam folder.',
  mail: 'Why this one first: if mail does not land, every follow-up in the other eight is shouting into a spam folder.',
  ads: 'Why this one first: this is the finding actively burning budget while the others sit still.',
  megaphone: 'Why this one first: this is the finding actively burning budget while the others sit still.',
  tracking: 'Why this one first: until this is fixed, you cannot prove whether the other eight are improving.',
  mobile: 'Why this one first: most of your traffic is on a phone, so this finding is most of your problem.',
  phone: 'Why this one first: most of your traffic is on a phone, so this finding is most of your problem.',
};

const WHY_FIRST_FALLBACK =
  'Why this one first: it is the finding with the shortest path between a fix and a number that moves.';

export function whyThisFirst(dimension: string | null | undefined): string {
  if (!dimension) return WHY_FIRST_FALLBACK;
  return WHY_FIRST[dimension] ?? WHY_FIRST_FALLBACK;
}

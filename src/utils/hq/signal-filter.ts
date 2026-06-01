// Single source of truth for "is this prospect worth surfacing to the
// action center / digest / HOT alert pipeline." Every surface that decides
// "should this prospect show up here" calls isActionableProspect — so
// /action-center filter, /hq banner count, daily digest top-3, multi-viewer
// HOT pass, returning-engaged HOT pass, and /api/hq/notify suppression all
// agree on the bar.
//
// Why centralised: the alternative is each surface re-deriving "is this
// real signal" from raw fields. We tried that on /hq and it drifted —
// the daily digest filtered on (dwell>=15 OR cta>0), the Action Queue
// sort was heat_score, and the HOT alert fired on any cta_click. Three
// definitions of "actionable" that didn't agree. This file ends that.
//
// HogQL alignment: the HEAT_SCORE_SQL block in src/utils/posthog/query.ts
// runs in ClickHouse and cannot share runtime with this file. The
// constants and predicates below mirror that block's weights and
// thresholds. If you change one, change both — and update the unit
// tests so the drift is caught.
//
// Reference weights (from HEAT_SCORE_SQL):
//   prints * 40
//   copies * 30
//   distinct_visitors >= 2  → +35  (multi-viewer)
//   distinct_visitors >= 3  → +25  additive
//   distinct_visitors >= 4  → +25  additive
//   cta_clicks * 25
//   related_clicks * 20  (memo_related / memo_to_mri)
//   scroll_100s * 15
//   verdict_expansions * 10
//   return_visitor (when explicitly engaged) → +30
//   focus_seconds_total / 10, capped 20
//   total_dwell_seconds / 30, capped 10
//
// The thresholds below are the "should I write a DM today" cut, NOT the
// heat-score sort. The score sorts within the actionable set; this
// predicate decides who's in the set at all.

import type { TopProspect } from '../posthog/query';

export const SIGNAL_THRESHOLDS = {
  /** Multi-viewer floor: 2+ distinct people on an audit is the
   *  internal-share signal. The most reliable cold-outreach indicator
   *  we have. */
  MULTI_VIEWER_MIN: 2,

  /** Returning-engaged: a return visit only counts when paired with
   *  a real engagement event. Bare repeat-visits look like the same
   *  bot opening the page twice. */
  RETURNING_SESSIONS_MIN: 2,

  /** CTA-plus: a single CTA click is too noisy on its own (people
   *  misclick, browsers prefetch, etc.). We require a second signal
   *  to confirm intent. */
  CTA_MIN: 1,
} as const;

export type ActionableSignal =
  | 'multi_viewer'
  | 'returning_engaged'
  | 'cta_plus_engaged'
  | 'deep_read';

export type ProspectSignalClass =
  | 'commercial_intent'
  | 'team_read'
  | 'returning_read'
  | 'deep_read'
  | 'light_read'
  | 'scanner_likely'
  | 'raw_open';

export interface ActionableVerdict {
  /** True when the prospect crosses any actionable threshold below. */
  actionable: boolean;
  /** Which signal earned the row. Null when not actionable. */
  signal: ActionableSignal | null;
  /** Plain-English why-line for the action surface. Null when not
   *  actionable. Used directly in the Action Center card strip and
   *  the email digest body. */
  why: string | null;
}

export interface ProspectSignalClassification {
  actionable: boolean;
  signal: ActionableSignal | null;
  kind: ProspectSignalClass;
  label: string;
  temp: 'hot' | 'warm' | 'cool' | 'cold';
  why: string;
  evidence: string[];
}

const NOT_ACTIONABLE: ActionableVerdict = {
  actionable: false,
  signal: null,
  why: null,
};

/** Explicit reader actions. Dwell/focus are useful context, but scanners
 *  can produce them, so they do not make a prospect actionable by themselves. */
function hasReaderInteraction(p: TopProspect): boolean {
  return (
    p.scroll_100s > 0 ||
    p.verdict_expansions > 0 ||
    p.copies > 0 ||
    p.prints > 0 ||
    p.related_clicks > 0 ||
    (p.expanded_dimensions?.length ?? 0) > 0
  );
}

function hasCtaCoSignal(p: TopProspect): boolean {
  return (
    p.scroll_100s > 0 ||
    p.verdict_expansions > 0 ||
    p.copies > 0 ||
    p.prints > 0 ||
    p.related_clicks > 0 ||
    (p.expanded_dimensions?.length ?? 0) > 0
  );
}

function evidenceFor(p: TopProspect): string[] {
  const out: string[] = [];
  const expandedCount = p.expanded_dimensions?.length ?? 0;
  if (p.distinct_visitors >= 2) out.push(`${p.distinct_visitors} people`);
  if (p.unique_sessions >= 2) out.push(`${p.unique_sessions} sessions`);
  if (p.cta_clicks > 0) out.push(`${p.cta_clicks} CTA${p.cta_clicks === 1 ? '' : 's'}`);
  if (p.related_clicks > 0) out.push(`${p.related_clicks} related click${p.related_clicks === 1 ? '' : 's'}`);
  if (p.scroll_100s > 0) out.push(`${p.scroll_100s} full read${p.scroll_100s === 1 ? '' : 's'}`);
  if (p.verdict_expansions > 0) out.push(`${p.verdict_expansions} verdict open${p.verdict_expansions === 1 ? '' : 's'}`);
  if (expandedCount > 0) out.push(`${expandedCount} cells opened`);
  if (p.copies > 0) out.push(`${p.copies} copy${p.copies === 1 ? '' : 'ies'}`);
  if (p.prints > 0) out.push(`${p.prints} print${p.prints === 1 ? '' : 's'}`);
  if (p.total_dwell_seconds > 0) out.push(`${p.total_dwell_seconds}s dwell`);
  return out.slice(0, 5);
}

export function classifyProspectSignal(p: TopProspect): ProspectSignalClassification {
  const evidence = evidenceFor(p);
  const interacted = hasReaderInteraction(p);

  if (p.distinct_visitors >= SIGNAL_THRESHOLDS.MULTI_VIEWER_MIN && interacted) {
    return {
      actionable: true,
      signal: 'multi_viewer',
      kind: 'team_read',
      label: 'team read',
      temp: 'hot',
      why: `${p.distinct_visitors} people interacted with the memo.`,
      evidence,
    };
  }

  if (p.cta_clicks >= SIGNAL_THRESHOLDS.CTA_MIN && hasCtaCoSignal(p)) {
    return {
      actionable: true,
      signal: 'cta_plus_engaged',
      kind: 'commercial_intent',
      label: 'commercial intent',
      temp: 'hot',
      why: 'Clicked a CTA with a real engagement co-signal.',
      evidence,
    };
  }

  if (
    p.unique_sessions >= SIGNAL_THRESHOLDS.RETURNING_SESSIONS_MIN &&
    interacted
  ) {
    return {
      actionable: true,
      signal: 'returning_engaged',
      kind: 'returning_read',
      label: 'returning read',
      temp: 'warm',
      why: `Returned ${p.unique_sessions} times and interacted.`,
      evidence,
    };
  }

  if (interacted) {
    const saved = p.copies > 0 || p.prints > 0 || p.related_clicks > 0;
    return {
      actionable: true,
      signal: 'deep_read',
      kind: saved ? 'commercial_intent' : 'deep_read',
      label: saved ? 'saved or explored' : 'deep read',
      temp: saved ? 'hot' : 'warm',
      why: saved
        ? 'Saved, copied, or explored beyond the memo.'
        : 'Interacted with the memo beyond a raw open.',
      evidence,
    };
  }

  if (p.total_dwell_seconds >= 30 || p.focus_seconds_total >= 10) {
    return {
      actionable: false,
      signal: null,
      kind: 'scanner_likely',
      label: 'scanner-shaped',
      temp: 'cold',
      why: 'Dwell/focus appeared without scrolls, opens, copies, prints, or CTA context.',
      evidence,
    };
  }

  if (p.total_views > 0 || p.unique_sessions > 0) {
    return {
      actionable: false,
      signal: null,
      kind: 'raw_open',
      label: 'raw open',
      temp: 'cold',
      why: 'Opened the page, but no human interaction signal fired.',
      evidence,
    };
  }

  return {
    actionable: false,
    signal: null,
    kind: 'light_read',
    label: 'light read',
    temp: 'cool',
    why: 'Light activity only.',
    evidence,
  };
}

/** The single decision function for "does this prospect deserve a
 *  spot on the action center today?" Returns the strongest signal
 *  category (multi-viewer wins over returning, which wins over cta)
 *  and a human-readable why-line for the UI. */
export function isActionableProspect(p: TopProspect): ActionableVerdict {
  const classified = classifyProspectSignal(p);
  if (!classified.actionable || !classified.signal) return NOT_ACTIONABLE;
  return {
    actionable: true,
    signal: classified.signal,
    why: classified.why,
  };
}

/** Convenience filter: returns only the actionable prospects, in their
 *  original order. The caller is responsible for sorting (usually by
 *  heat_score DESC, which already weights these same signals). */
export function filterActionable(prospects: TopProspect[]): TopProspect[] {
  return prospects.filter((p) => isActionableProspect(p).actionable);
}

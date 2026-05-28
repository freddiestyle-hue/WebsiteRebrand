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
//   return_visitor (when engaged) → +30
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
  RETURNING_DWELL_MIN: 30,

  /** CTA-plus: a single CTA click is too noisy on its own (people
   *  misclick, browsers prefetch, etc.). We require a second signal
   *  to confirm intent. */
  CTA_MIN: 1,
} as const;

export type ActionableSignal =
  | 'multi_viewer'
  | 'returning_engaged'
  | 'cta_plus_engaged';

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

const NOT_ACTIONABLE: ActionableVerdict = {
  actionable: false,
  signal: null,
  why: null,
};

/** True when the prospect has engagement beyond a single drive-by
 *  visit. Used by the returning-engaged branch and the CTA-plus
 *  branch to require a co-signal alongside the primary trigger. */
function hasRealEngagement(p: TopProspect): boolean {
  return (
    p.scroll_100s > 0 ||
    p.total_dwell_seconds >= SIGNAL_THRESHOLDS.RETURNING_DWELL_MIN ||
    p.verdict_expansions > 0 ||
    p.copies > 0 ||
    p.prints > 0 ||
    p.related_clicks > 0 ||
    (p.expanded_dimensions?.length ?? 0) > 0
  );
}

/** The single decision function for "does this prospect deserve a
 *  spot on the action center today?" Returns the strongest signal
 *  category (multi-viewer wins over returning, which wins over cta)
 *  and a human-readable why-line for the UI. */
export function isActionableProspect(p: TopProspect): ActionableVerdict {
  // Multi-viewer wins. Distinct people on one audit is the cleanest
  // internal-forward signal. Order: 4+ > 3 > 2 because the wording
  // shifts but the predicate is the same.
  if (p.distinct_visitors >= SIGNAL_THRESHOLDS.MULTI_VIEWER_MIN) {
    return {
      actionable: true,
      signal: 'multi_viewer',
      why: `${p.distinct_visitors} people read it`,
    };
  }

  // Returning + engaged. A return visit on its own is too easy to trip
  // (same person reopening a tab, browser back-button). Pair it with
  // a real engagement event.
  if (
    p.unique_sessions >= SIGNAL_THRESHOLDS.RETURNING_SESSIONS_MIN &&
    hasRealEngagement(p)
  ) {
    return {
      actionable: true,
      signal: 'returning_engaged',
      why: `Returned ${p.unique_sessions}× and engaged`,
    };
  }

  // CTA click + something. Bare cta_click is noisy (misclicks,
  // prefetch, bot CTA-following). Require a second signal.
  if (p.cta_clicks >= SIGNAL_THRESHOLDS.CTA_MIN && hasRealEngagement(p)) {
    return {
      actionable: true,
      signal: 'cta_plus_engaged',
      why: `Clicked Book a call + engaged`,
    };
  }

  return NOT_ACTIONABLE;
}

/** Convenience filter: returns only the actionable prospects, in their
 *  original order. The caller is responsible for sorting (usually by
 *  heat_score DESC, which already weights these same signals). */
export function filterActionable(prospects: TopProspect[]): TopProspect[] {
  return prospects.filter((p) => isActionableProspect(p).actionable);
}

import { describe, it, expect } from 'vitest';
import {
  isActionableProspect,
  filterActionable,
  SIGNAL_THRESHOLDS,
} from '../signal-filter';
import type { TopProspect } from '../../posthog/query';

/**
 * Action Center signal-filter tests. The helper is the single source of
 * truth for "does this prospect get surfaced anywhere" (action-center
 * page, /hq banner count, daily digest top-3, HOT alert suppression).
 * Drift between this filter and HEAT_SCORE_SQL in query.ts is the failure
 * mode these tests guard against.
 */

function baseProspect(overrides: Partial<TopProspect> = {}): TopProspect {
  return {
    prospect: 'test-co',
    surface: 'audit',
    total_views: 1,
    unique_sessions: 1,
    distinct_visitors: 1,
    total_dwell_seconds: 0,
    cta_clicks: 0,
    verdict_expansions: 0,
    scroll_100s: 0,
    copies: 0,
    prints: 0,
    focus_seconds_total: 0,
    related_clicks: 0,
    expanded_dimensions: [],
    return_visitor: false,
    heat_score: 0,
    last_view: '2026-05-28T00:00:00Z',
    sessions: [],
    ...overrides,
  };
}

describe('isActionableProspect — multi-viewer branch', () => {
  it('actionable at 2 distinct visitors', () => {
    const v = isActionableProspect(baseProspect({ distinct_visitors: 2 }));
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('multi_viewer');
    expect(v.why).toContain('2 people');
  });

  it('actionable at 4 distinct visitors with correct count in why-line', () => {
    const v = isActionableProspect(baseProspect({ distinct_visitors: 4 }));
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('multi_viewer');
    expect(v.why).toBe('4 people read it');
  });

  it('not actionable at exactly 1 distinct visitor (the threshold floor)', () => {
    const v = isActionableProspect(baseProspect({ distinct_visitors: 1 }));
    expect(v.actionable).toBe(false);
    expect(v.signal).toBeNull();
  });

  it('multi-viewer wins over returning-engaged when both apply', () => {
    const v = isActionableProspect(
      baseProspect({
        distinct_visitors: 3,
        unique_sessions: 5,
        total_dwell_seconds: 200,
      })
    );
    expect(v.signal).toBe('multi_viewer');
  });
});

describe('isActionableProspect — returning + engaged branch', () => {
  it('actionable with 2+ sessions and a real engagement event (scroll_100)', () => {
    const v = isActionableProspect(
      baseProspect({ unique_sessions: 2, scroll_100s: 1 })
    );
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('returning_engaged');
    expect(v.why).toContain('Returned');
  });

  it('actionable with 2+ sessions and 30s+ dwell', () => {
    const v = isActionableProspect(
      baseProspect({ unique_sessions: 2, total_dwell_seconds: 35 })
    );
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('returning_engaged');
  });

  it('actionable with 2+ sessions and a verdict expansion', () => {
    const v = isActionableProspect(
      baseProspect({ unique_sessions: 2, verdict_expansions: 1 })
    );
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('returning_engaged');
  });

  it('actionable with 2+ sessions and any expanded_dimension', () => {
    const v = isActionableProspect(
      baseProspect({ unique_sessions: 2, expanded_dimensions: ['search'] })
    );
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('returning_engaged');
  });

  it('NOT actionable when sessions >= 2 but no engagement co-signal', () => {
    const v = isActionableProspect(
      baseProspect({ unique_sessions: 3, total_dwell_seconds: 5 })
    );
    expect(v.actionable).toBe(false);
  });

  it('NOT actionable with single session even if engagement is high', () => {
    const v = isActionableProspect(
      baseProspect({ unique_sessions: 1, scroll_100s: 1, total_dwell_seconds: 120 })
    );
    expect(v.actionable).toBe(false);
  });

  it('dwell threshold is at the exact RETURNING_DWELL_MIN value', () => {
    const below = isActionableProspect(
      baseProspect({
        unique_sessions: 2,
        total_dwell_seconds: SIGNAL_THRESHOLDS.RETURNING_DWELL_MIN - 1,
      })
    );
    const exact = isActionableProspect(
      baseProspect({
        unique_sessions: 2,
        total_dwell_seconds: SIGNAL_THRESHOLDS.RETURNING_DWELL_MIN,
      })
    );
    expect(below.actionable).toBe(false);
    expect(exact.actionable).toBe(true);
  });
});

describe('isActionableProspect — CTA + engaged branch', () => {
  it('actionable with cta_click + scroll_100', () => {
    const v = isActionableProspect(
      baseProspect({ cta_clicks: 1, scroll_100s: 1 })
    );
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('cta_plus_engaged');
  });

  it('actionable with cta_click + 30s+ dwell', () => {
    const v = isActionableProspect(
      baseProspect({ cta_clicks: 1, total_dwell_seconds: 60 })
    );
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('cta_plus_engaged');
  });

  it('actionable with cta_click + a content_copied event', () => {
    const v = isActionableProspect(
      baseProspect({ cta_clicks: 1, copies: 1 })
    );
    expect(v.actionable).toBe(true);
    expect(v.signal).toBe('cta_plus_engaged');
  });

  it('NOT actionable with cta_click alone (no co-signal)', () => {
    const v = isActionableProspect(
      baseProspect({ cta_clicks: 1, total_dwell_seconds: 0 })
    );
    expect(v.actionable).toBe(false);
    expect(v.signal).toBeNull();
  });

  it('NOT actionable with cta_click + very-short dwell (under 30s)', () => {
    const v = isActionableProspect(
      baseProspect({ cta_clicks: 1, total_dwell_seconds: 12 })
    );
    expect(v.actionable).toBe(false);
  });
});

describe('isActionableProspect — drive-by and edge cases', () => {
  it('NOT actionable for default empty prospect', () => {
    const v = isActionableProspect(baseProspect());
    expect(v.actionable).toBe(false);
    expect(v.signal).toBeNull();
    expect(v.why).toBeNull();
  });

  it('NOT actionable for single session with 30s dwell (need return)', () => {
    const v = isActionableProspect(
      baseProspect({ unique_sessions: 1, total_dwell_seconds: 100 })
    );
    expect(v.actionable).toBe(false);
  });

  it('NOT actionable for high views from a single bot-looking visitor', () => {
    // A bot pattern: 20 views, 1 session, 1 distinct visitor, no engagement
    const v = isActionableProspect(
      baseProspect({
        total_views: 20,
        unique_sessions: 1,
        distinct_visitors: 1,
        total_dwell_seconds: 0,
      })
    );
    expect(v.actionable).toBe(false);
  });

  it('handles missing expanded_dimensions array gracefully', () => {
    // Older cached rows may lack the field. The helper should not throw.
    const v = isActionableProspect(
      baseProspect({
        unique_sessions: 2,
        expanded_dimensions: undefined as unknown as string[],
        total_dwell_seconds: 40,
      })
    );
    expect(v.actionable).toBe(true);
  });
});

describe('filterActionable', () => {
  it('returns only actionable prospects, preserves order', () => {
    const list: TopProspect[] = [
      baseProspect({ prospect: 'a', distinct_visitors: 1 }),
      baseProspect({ prospect: 'b', distinct_visitors: 3 }),
      baseProspect({
        prospect: 'c',
        unique_sessions: 2,
        total_dwell_seconds: 50,
      }),
      baseProspect({ prospect: 'd', cta_clicks: 1 }), // not actionable
    ];
    const out = filterActionable(list);
    expect(out.map((p) => p.prospect)).toEqual(['b', 'c']);
  });

  it('returns empty array when no prospect is actionable', () => {
    const list: TopProspect[] = [
      baseProspect({ prospect: 'a' }),
      baseProspect({ prospect: 'b', total_dwell_seconds: 5 }),
    ];
    expect(filterActionable(list)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(filterActionable([])).toEqual([]);
  });
});

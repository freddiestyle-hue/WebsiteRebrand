import { describe, it, expect } from 'vitest';
import { pickHeroFinding } from '../pick-hero';
import type { Memo, VerdictCell, VerdictIcon } from '../memo-schema';

function cell(icon: VerdictIcon, checks: { ok: boolean; text: string }[]): VerdictCell {
  return {
    icon,
    heading: `${icon} heading`,
    value: 'n/a',
    note: 'A neutral note.',
    checks,
  };
}

function mkMemo(cells: VerdictCell[]): Memo {
  return {
    version: '2.0.0',
    slug: 'acme-test-0123456789abcdef',
    domain: 'acme.test',
    generatedAt: new Date().toISOString(),
    cover: { kicker: 'Kicker', roman: 'Roman' },
    verdictCells: cells,
    rankedFixes: [{ rank: 1, what: 'Do the thing', why: 'Because', effort: 'low', impact: 'high' }],
    personalObservation: { text: 'An observation.' },
  };
}

const fail = [{ ok: false, text: 'A failing check.' }];

// The rule-based fallback hero has no access to a prospect's real LCP, pixel
// count, or spam rate, so its canned copy must not state any. A figure like
// "30+ pixels" in a static string reads as a measured finding and is false
// the moment the prospect's real count differs.
describe('pickHeroFinding fallback copy stays honest', () => {
  it('email one-liner states no invented proportion', () => {
    const hero = pickHeroFinding(mkMemo([cell('mail', fail)]));
    expect(hero.dimension).toBe('email');
    expect(hero.oneLiner.toLowerCase()).not.toContain('half');
    expect(hero.oneLiner).not.toMatch(/\d/);
  });

  it('tracking copy states no invented pixel count', () => {
    const hero = pickHeroFinding(mkMemo([cell('target', fail)]));
    expect(hero.dimension).toBe('tracking');
    expect(hero.oneLiner).not.toMatch(/\d/);
    expect(hero.diagnosis).not.toMatch(/\d/);
  });

  it('pagespeed copy states no invented load time', () => {
    const hero = pickHeroFinding(mkMemo([cell('bolt', fail)]));
    expect(hero.dimension).toBe('pagespeed');
    expect(hero.oneLiner).not.toMatch(/\d/);
    expect(hero.diagnosis).not.toMatch(/\d/);
  });
});

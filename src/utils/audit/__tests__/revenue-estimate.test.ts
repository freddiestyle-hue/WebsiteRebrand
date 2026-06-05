import { describe, it, expect } from 'vitest';
import { buildRevenueEstimate, lcpSeconds } from '../revenue-estimate';
import { MEMO_SCHEMA_VERSION, type Memo, type VerdictCell, type VerdictIcon } from '../memo-schema';

function cell(icon: VerdictIcon, over: Partial<VerdictCell> = {}): VerdictCell {
  return {
    icon,
    heading: over.heading ?? `${icon} heading`,
    value: over.value ?? 'n/a',
    note: over.note ?? 'A neutral note.',
    checks: over.checks ?? [],
  };
}

function mkMemo(cells: VerdictCell[]): Memo {
  return {
    version: MEMO_SCHEMA_VERSION,
    slug: 'acme-test-0123456789abcdef',
    domain: 'acme.test',
    generatedAt: new Date().toISOString(),
    cover: { kicker: 'Kicker', roman: 'Roman' },
    verdictCells: cells,
    rankedFixes: [{ rank: 1, what: 'Do the thing', why: 'Because', effort: 'low', impact: 'high' }],
    personalObservation: { text: 'An observation.' },
  };
}

const slowBolt = cell('bolt', {
  value: '34 / 100',
  note: 'Slow. 4.6s LCP, 2.1s FCP. Ad conversions drop ~7% per second of delay.',
});
const adsOn = cell('megaphone', { value: '3 campaigns', note: 'Running paid ads to the homepage.' });
const adsOff = cell('megaphone', { value: 'None', note: 'No active ad campaigns detected.' });
const filler = cell('search', { note: 'Filler dimension.' });

describe('lcpSeconds', () => {
  it('parses "4.6s LCP" from the cell note', () => {
    expect(lcpSeconds(slowBolt)).toBe(4.6);
  });

  it('parses "paints in 5.2s" from a check', () => {
    const c = cell('bolt', {
      note: 'Slow.',
      checks: [{ ok: false, text: 'Largest content paints in 5.2s (Google "good" threshold: 2.5s)' }],
    });
    expect(lcpSeconds(c)).toBe(5.2);
  });

  it('returns null when no LCP is stated, or no cell', () => {
    expect(lcpSeconds(cell('bolt', { note: 'Fast enough on mobile.' }))).toBeNull();
    expect(lcpSeconds(undefined)).toBeNull();
  });
});

describe('buildRevenueEstimate', () => {
  it('models a speed leak against ad budget when ads run', () => {
    const r = buildRevenueEstimate(mkMemo([slowBolt, adsOn, filler]));
    expect(r).not.toBeNull();
    expect(r).toContain('4.6s');
    expect(r).toContain('13 to 17%');
    expect(r).toContain('ad budget');
  });

  it('frames the speed leak for mobile visitors when no ads run', () => {
    const r = buildRevenueEstimate(mkMemo([slowBolt, adsOff, filler]));
    expect(r).toContain('mobile visitors');
    expect(r).not.toContain('ad budget');
  });

  it('skips a speed estimate when the page is only just over the threshold', () => {
    const borderline = cell('bolt', { value: '78 / 100', note: 'Borderline. 3.0s LCP, 1.4s FCP on mobile.' });
    expect(buildRevenueEstimate(mkMemo([borderline, adsOff, filler]))).toBeNull();
  });

  it('reports the conversion proportion when speed gives no basis', () => {
    const eye = cell('eye', {
      heading: 'Conversion path',
      checks: [
        { ok: true, text: 'Form available on the site' },
        { ok: false, text: 'Tappable phone number' },
        { ok: false, text: 'Prominent CTA above the fold' },
        { ok: true, text: 'Self-serve scheduling link' },
      ],
    });
    const r = buildRevenueEstimate(mkMemo([eye, adsOff, filler]));
    expect(r).toContain('2 of 4');
    expect(r).toContain('50%');
    expect(r).toContain('no safe way to size');
  });

  it('returns null when the audit gives no quantifiable leak', () => {
    const fast = cell('bolt', { value: '96 / 100', note: 'Fast on mobile.' });
    expect(buildRevenueEstimate(mkMemo([fast, adsOff, filler]))).toBeNull();
  });
});

// Regression for the "Verified path painted red" bug (Fred, 2026-06-10):
// verdict strings carry their own polarity and must never be re-toned by the
// passing-ratio fallback, even when secondary rows in the cell fail.
import { describe, expect, it } from 'vitest';
import type { VerdictCell } from '../memo-schema';
import { deriveTone } from '../locked-observation';

function cell(value: string, checks: Array<{ ok: boolean }>): VerdictCell {
  return { icon: 'eye', heading: 'Conversion path', value, note: 'n', checks: checks.map((c) => ({ ...c, text: 't' })) } as VerdictCell;
}

describe('deriveTone verdict strings', () => {
  it('"Verified path" is good, even with failing secondary rows', () => {
    expect(deriveTone(cell('Verified path', [{ ok: true }, { ok: false }, { ok: false }, { ok: false }]))).toBe('good');
  });

  it('"Verified gap" is always halt', () => {
    expect(deriveTone(cell('Verified gap', [{ ok: true }, { ok: true }]))).toBe('halt');
  });

  it('"Clean" is good', () => {
    expect(deriveTone(cell('Clean', [{ ok: false }]))).toBe('good');
  });

  it('clean sweeps and high scores are good (green), per the 2026-06-10 rubric', () => {
    expect(deriveTone(cell('4 of 4 verified', [{ ok: true }]))).toBe('good');
    expect(deriveTone(cell('92 / 100', [{ ok: true }]))).toBe('good');
    expect(deriveTone(cell('0 issues', [{ ok: true }]))).toBe('good');
  });

  it('"unconfirmed" is amber, never red - absence of proof is not proven failure', () => {
    expect(deriveTone(cell('unconfirmed', [{ ok: false }, { ok: false }]))).toBe('warn');
  });

  it('mediocre stays amber, bad stays red', () => {
    expect(deriveTone(cell('9 of 10 verified', [{ ok: true }]))).toBe('warn');
    expect(deriveTone(cell('1 of 4', [{ ok: false }]))).toBe('halt');
  });

  it('ratio fallback still applies to non-verdict values', () => {
    expect(deriveTone(cell('1 of 4', [{ ok: false }]))).toBe('halt');
  });
});

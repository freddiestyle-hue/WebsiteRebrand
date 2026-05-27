import { describe, it, expect } from 'vitest';
import { reliabilityFor, type DraftCheck } from '../engine';

// Minimal DraftCheck builder. reliabilityFor reads only id, passed, and
// measurement; the other fields are filler.
function check(over: Partial<DraftCheck> & { id: string; passed: boolean }): DraftCheck {
  return {
    category: 'crawl',
    label: 'test check',
    weight: 1,
    evidence: '',
    finding: '',
    ...over,
  };
}

describe('reliabilityFor', () => {
  it('a found HTML-parsed check is verified - presence is fact', () => {
    expect(reliabilityFor(check({ id: 'org-schema', passed: true }))).toBe('verified');
    expect(reliabilityFor(check({ id: 'website-schema', passed: true }))).toBe('verified');
  });

  it('an absent HTML-parsed check is soft-absence - the parse false-negatives', () => {
    expect(reliabilityFor(check({ id: 'org-schema', passed: false }))).toBe('soft-absence');
    expect(reliabilityFor(check({ id: 'canonical', passed: false }))).toBe('soft-absence');
    expect(reliabilityFor(check({ id: 'og-type', passed: false }))).toBe('soft-absence');
  });

  it('the trust-signal allowlist absence is soft - it false-negatives on most SMBs', () => {
    expect(reliabilityFor(check({ id: 'trust-signal', passed: false }))).toBe('soft-absence');
  });

  it('an absent /llms.txt is verified - a 404 from a real fetch is authoritative', () => {
    expect(reliabilityFor(check({ id: 'llms-txt', passed: false }))).toBe('verified');
    expect(reliabilityFor(check({ id: 'llms-full', passed: false }))).toBe('verified');
  });

  it('robots checks are verified either way - a real fetch of a small text file', () => {
    expect(reliabilityFor(check({ id: 'robots', passed: false }))).toBe('verified');
    expect(reliabilityFor(check({ id: 'robots-sitemap', passed: false }))).toBe('verified');
  });

  it('an absent conversion signal is soft - forms can be iframe or JS-rendered', () => {
    expect(reliabilityFor(check({ id: 'conversion-form-on-page', passed: false }))).toBe('soft-absence');
    expect(reliabilityFor(check({ id: 'conversion-prominent-cta', passed: false }))).toBe('soft-absence');
  });

  it('a found conversion signal is verified', () => {
    expect(reliabilityFor(check({ id: 'conversion-form-on-page', passed: true }))).toBe('verified');
  });

  it('tracking that fired or was seen on the page is verified', () => {
    expect(
      reliabilityFor(check({ id: 'tracking-ga4', passed: true, measurement: { state: 'firing', events: [] } })),
    ).toBe('verified');
    expect(
      reliabilityFor(check({ id: 'tracking-meta-pixel', passed: true, measurement: { state: 'present', events: [] } })),
    ).toBe('verified');
    expect(
      reliabilityFor(
        check({ id: 'tracking-ga4', passed: true, measurement: { state: 'events-observed', events: ['purchase'] } }),
      ),
    ).toBe('verified');
  });

  it('absent tracking is soft - a tag can load late or sit behind a consent gate', () => {
    expect(
      reliabilityFor(check({ id: 'tracking-meta-pixel', passed: false, measurement: { state: 'absent', events: [] } })),
    ).toBe('soft-absence');
  });

  describe('when the headless pass rendered the DOM', () => {
    // Headless renders the page in real Chromium with full JS, waits 800ms
    // post-networkidle, scrolls to bottom + back to fire scroll-triggered
    // injects, and re-captures HTML. After all that, if a parser doesn't
    // find org-schema / canonical / a form / a tappable phone - the prospect
    // genuinely doesn't have it. Absence is verified, not soft.
    it('HTML-parsed absences become verified when headless ran', () => {
      expect(reliabilityFor(check({ id: 'org-schema', passed: false }), true)).toBe('verified');
      expect(reliabilityFor(check({ id: 'canonical', passed: false }), true)).toBe('verified');
      expect(reliabilityFor(check({ id: 'og-type', passed: false }), true)).toBe('verified');
      expect(reliabilityFor(check({ id: 'trust-signal', passed: false }), true)).toBe('verified');
      expect(reliabilityFor(check({ id: 'conversion-form-on-page', passed: false }), true)).toBe(
        'verified',
      );
      expect(reliabilityFor(check({ id: 'conversion-prominent-cta', passed: false }), true)).toBe(
        'verified',
      );
    });

    it('positive results stay verified when headless ran', () => {
      expect(reliabilityFor(check({ id: 'org-schema', passed: true }), true)).toBe('verified');
      expect(reliabilityFor(check({ id: 'conversion-form-on-page', passed: true }), true)).toBe(
        'verified',
      );
    });

    it('tracking absences stay soft even when headless ran (consent gate, late fire)', () => {
      // Headless can scroll and wait but cannot bypass a consent banner that
      // gates Meta Pixel. The exception that proves the rule.
      expect(
        reliabilityFor(
          check({
            id: 'tracking-meta-pixel',
            passed: false,
            measurement: { state: 'absent', events: [] },
          }),
          true,
        ),
      ).toBe('soft-absence');
    });

    it('real-network-fetch checks stay verified regardless of headless flag', () => {
      expect(reliabilityFor(check({ id: 'llms-txt', passed: false }), true)).toBe('verified');
      expect(reliabilityFor(check({ id: 'robots', passed: false }), true)).toBe('verified');
    });
  });
});

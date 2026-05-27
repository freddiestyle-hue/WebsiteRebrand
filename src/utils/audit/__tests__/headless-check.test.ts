import { describe, it, expect } from 'vitest';
import { isConsentAcceptText } from '../headless-check';

/**
 * Upgrade 10 - consent-aware tracking measurement. Pure-function tests for
 * the text-pattern matcher that decides which buttons read as "accept
 * consent" vs "reject consent". The browser-driven path (CMP selectors,
 * page.evaluate fallback, post-click wait) is tested via the integration
 * suite (which is currently broken on main due to bun/vitest compat - see
 * engine-rendered-dom.test.ts).
 *
 * The cost of a wrong match is high in both directions:
 *   - false positive on "Reject all": we tank consent and report broken
 *     pixels when the prospect just lost their tracking grant
 *   - false negative on "Accept": we report "present, not firing" on a
 *     site whose pixels would have fired with one click
 *
 * Every case below maps to a real CMP button text observed in the wild.
 */

describe('isConsentAcceptText (Upgrade 10)', () => {
  describe('accept variants', () => {
    it.each([
      'Accept',
      'Accept all',
      'Accept All',
      'Accept all cookies',
      'Accept cookies',
      'Allow all',
      'Allow All Cookies',
      'I agree',
      'Agree',
      'Got it',
      'Continue',
      'Confirm',
      'I understand',
      "I'm OK",
    ])('matches "%s" as accept', (text) => {
      expect(isConsentAcceptText(text)).toBe(true);
    });
  });

  describe('reject variants (never match)', () => {
    it.each([
      'Reject all',
      'Reject',
      'Decline',
      'Decline all',
      'Decline cookies',
      'Deny',
      'Opt out',
      'Opt-out',
      'Refuse',
      'Disagree',
      // The "Reject all cookies" case is the most dangerous false-positive:
      // it contains "all" and the original strict matcher would have skipped
      // it only by exact-text mismatch. The new boundary regex must
      // explicitly hard-block the reject verbs.
      'Reject all cookies',
    ])('rejects "%s" as accept (consent rejection variant)', (text) => {
      expect(isConsentAcceptText(text)).toBe(false);
    });
  });

  describe('boundary cases', () => {
    it('rejects empty string', () => {
      expect(isConsentAcceptText('')).toBe(false);
    });

    it('rejects whitespace-only string', () => {
      expect(isConsentAcceptText('   \t\n  ')).toBe(false);
    });

    it('rejects strings longer than 60 chars (probably not a button)', () => {
      const longText =
        'I accept the terms and conditions and the privacy policy and the cookie policy';
      expect(longText.length).toBeGreaterThan(60);
      expect(isConsentAcceptText(longText)).toBe(false);
    });

    it('normalises whitespace before matching', () => {
      expect(isConsentAcceptText('Accept\n   all\tcookies')).toBe(true);
    });

    it('rejects unrelated button text', () => {
      expect(isConsentAcceptText('Submit')).toBe(false);
      expect(isConsentAcceptText('Search')).toBe(false);
      expect(isConsentAcceptText('Menu')).toBe(false);
      expect(isConsentAcceptText('Sign in')).toBe(false);
      expect(isConsentAcceptText('Learn more')).toBe(false);
    });

    it('rejects "Acceptable" (word-boundary guard against partial matches)', () => {
      // The bare word "accept" must not match inside "Acceptable" or
      // "Acceptance" - those aren't consent buttons.
      expect(isConsentAcceptText('Acceptable use policy')).toBe(false);
    });
  });

  describe('case sensitivity', () => {
    it('matches regardless of case', () => {
      expect(isConsentAcceptText('ACCEPT ALL')).toBe(true);
      expect(isConsentAcceptText('accept all')).toBe(true);
      expect(isConsentAcceptText('Accept All')).toBe(true);
    });
  });
});

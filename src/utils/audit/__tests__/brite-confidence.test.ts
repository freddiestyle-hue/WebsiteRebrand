import { describe, expect, it } from 'vitest';
import { confidenceCopy, findingLead } from '../brite-confidence';
import type { Reliability } from '../memo-schema';

describe('Brite confidence copy', () => {
  it('allows assertive copy only for verified findings', () => {
    expect(confidenceCopy('verified').assertive).toBe(true);
    expect(findingLead('verified')).toBe('Finding');

    const nonAssertive: Reliability[] = ['soft-absence', 'inferred', 'verified-na'];
    for (const reliability of nonAssertive) {
      const copy = confidenceCopy(reliability);
      expect(copy.assertive).toBe(false);
      expect(findingLead(reliability)).toBe('Question');
      expect(`${copy.label} ${copy.detail}`.toLowerCase()).not.toContain('verified finding');
      expect(`${copy.label} ${copy.detail}`.toLowerCase()).not.toContain('fact');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { buildIndustryContext } from '../icp-context';
import slugToIcp from '../slug-to-icp.json';
import icpVoice from '../icp-voice.json';

const slugMap = slugToIcp as Record<string, string | null>;

describe('buildIndustryContext', () => {
  it('builds a context block for a matched prospect', () => {
    // friedmanrealestate-com maps to 01-real-estate.
    const ctx = buildIndustryContext('friedmanrealestate-com');
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('Real Estate');
    // the operator voice line is carried through
    expect(ctx).toContain('explain.');
    // at least one stat-backed pain body is included
    expect(ctx).toContain('bounces 40 percent');
  });

  it('works for a different ICP and carries the framing guardrail', () => {
    // reedsmith-com maps to 06-legal. The framing line is what keeps the model
    // from reading industry stats as findings about this prospect.
    const ctx = buildIndustryContext('reedsmith-com');
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('Legal Practice');
    expect(ctx).toContain("not findings from this prospect's audit");
    expect(ctx).toContain("must still come from this prospect's own audit");
  });

  it('returns null for an off-ICP prospect (null in the map)', () => {
    // fermanbmw-com is mapped to null.
    expect(buildIndustryContext('fermanbmw-com')).toBeNull();
  });

  it('returns null for a slug that is not in the map', () => {
    expect(buildIndustryContext('definitely-not-a-real-slug-zzz')).toBeNull();
  });

  it('caps the known-pain list at three bullets', () => {
    const ctx = buildIndustryContext('friedmanrealestate-com') ?? '';
    const bullets = ctx.split('\n').filter((line) => line.startsWith('- '));
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(3);
  });

  it('every ICP a prospect maps to is defined in icp-voice.json', () => {
    // Guards the gated regeneration batch: a slug pointing at an ICP key that
    // icp-voice.json does not define would silently degrade to "Not available."
    const definedIcps = new Set(Object.keys(icpVoice));
    const referenced = new Set(
      Object.values(slugMap).filter((v): v is string => v != null),
    );
    for (const key of referenced) {
      expect(definedIcps.has(key)).toBe(true);
    }
  });

  it('returns a non-null block for every on-ICP prospect in the map', () => {
    for (const [slug, icp] of Object.entries(slugMap)) {
      if (icp != null) {
        expect(buildIndustryContext(slug)).not.toBeNull();
      }
    }
  });
});

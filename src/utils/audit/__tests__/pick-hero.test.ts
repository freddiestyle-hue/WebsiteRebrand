import { describe, it, expect } from 'vitest';
import { pickHeroFinding } from '../pick-hero';
import {
  MEMO_SCHEMA_VERSION,
  type Memo,
  type VerdictCell,
  type VerdictCheck,
  type VerdictIcon,
} from '../memo-schema';

function cell(icon: VerdictIcon, checks: VerdictCheck[], over: Partial<VerdictCell> = {}): VerdictCell {
  return {
    icon,
    heading: `${icon} heading`,
    value: 'n/a',
    note: 'A neutral note.',
    checks,
    ...over,
  };
}

// Megaphone cell with paid-ad signal that hasPaidAdsSignal() reads as "running"
// (it scans value + note for "active", "running", etc).
function adsRunningCell(): VerdictCell {
  return cell('megaphone', [{ ok: true, text: 'Google Ads: 10 active', reliability: 'verified' }], {
    value: '10 active ads',
    note: '10 active paid Google ads detected.',
  });
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

// "fail" is a single verified failure - enough to satisfy hasVerifiedFails
// for any dimension whose tier requires only one. (Mobile and PageSpeed need
// 2+ verified fails to hero, per the v3 tier-routing rules.)
const fail: VerdictCheck[] = [{ ok: false, text: 'A failing check.', reliability: 'verified' }];

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
    // Tier-routing requires 2+ verified Core Vitals fails before the hero
    // leads with page-speed; a single LCP miss is too noisy. The copy must
    // still state no numbers it didn't measure.
    const hero = pickHeroFinding(
      mkMemo([
        cell('bolt', [
          { ok: false, text: 'A failing check.', reliability: 'verified' },
          { ok: false, text: 'Another failing check.', reliability: 'verified' },
        ]),
      ]),
    );
    expect(hero.dimension).toBe('pagespeed');
    expect(hero.oneLiner).not.toMatch(/\d/);
    expect(hero.diagnosis).not.toMatch(/\d/);
  });
});

describe('pickHeroFinding only heroes verified failures', () => {
  it('does not lead with conversion when only soft-absence fails exist', () => {
    // Paid ads running, but every conversion fail is soft-absence (HTML
    // parse couldn't determine). The hero must NOT lead with conversion -
    // we never broadcast a leak we couldn't verify.
    const hero = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('eye', [
          { ok: false, text: 'Tappable phone number', reliability: 'soft-absence' },
          { ok: false, text: 'Self-serve scheduling link', reliability: 'soft-absence' },
        ]),
      ]),
    );
    // Should fall through to clean since no other dimension has verified fails.
    expect(hero.dimension).toBe('clean');
  });

  it('does not lead with conversion when failures are non-applicable or inferred', () => {
    const hero = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('eye', [
          { ok: false, text: 'LinkedIn Insight not applicable', reliability: 'verified-na' },
          { ok: false, text: 'Lifecycle ownership appears thin', reliability: 'inferred' },
        ]),
      ]),
    );
    expect(hero.dimension).toBe('clean');
  });

  it('does lead with conversion when there is at least one verified fail', () => {
    const hero = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('eye', [
          { ok: false, text: 'Tappable phone number', reliability: 'verified' },
          { ok: false, text: 'Self-serve scheduling link', reliability: 'soft-absence' },
        ]),
      ]),
    );
    expect(hero.dimension).toBe('conversion');
    // One-liner names the actual verified fail, not the soft-absence one.
    expect(hero.oneLiner).toContain('phone');
    expect(hero.oneLiner).not.toContain('scheduling');
  });

  it('pagespeed requires 2+ verified Core Vital fails - single LCP miss is too noisy', () => {
    const heroOne = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('bolt', [{ ok: false, text: 'Largest content paint', reliability: 'verified' }]),
      ]),
    );
    expect(heroOne.dimension).toBe('clean');

    const heroTwo = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('bolt', [
          { ok: false, text: 'Largest content paint', reliability: 'verified' },
          { ok: false, text: 'First content paint', reliability: 'verified' },
        ]),
      ]),
    );
    expect(heroTwo.dimension).toBe('pagespeed');
  });
});

describe('Hero one-liner reads actual failed check labels', () => {
  it('conversion one-liner mentions phone when that is the verified fail', () => {
    const hero = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('eye', [{ ok: false, text: 'Tappable phone number', reliability: 'verified' }]),
      ]),
    );
    expect(hero.oneLiner).toMatch(/phone/i);
  });

  it('conversion one-liner mentions form when that is the verified fail', () => {
    const hero = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('eye', [{ ok: false, text: 'Form available on the site', reliability: 'verified' }]),
      ]),
    );
    expect(hero.oneLiner).toMatch(/form/i);
  });

  it('email one-liner names which auth record is missing', () => {
    const hero = pickHeroFinding(
      mkMemo([
        cell('mail', [
          { ok: false, text: 'SPF: missing', reliability: 'verified' },
          { ok: false, text: 'DMARC: none', reliability: 'verified' },
        ]),
      ]),
    );
    expect(hero.oneLiner).toMatch(/SPF/);
    expect(hero.oneLiner).toMatch(/DMARC/);
  });

  it('two prospects with different verified fails get different one-liners', () => {
    // The original bug: every prospect got the same templated one-liner.
    // This test guards against that regression.
    const prospectA = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('eye', [{ ok: false, text: 'Tappable phone number', reliability: 'verified' }]),
      ]),
    );
    const prospectB = pickHeroFinding(
      mkMemo([
        adsRunningCell(),
        cell('eye', [{ ok: false, text: 'Form available on the site', reliability: 'verified' }]),
      ]),
    );
    expect(prospectA.oneLiner).not.toBe(prospectB.oneLiner);
  });
});

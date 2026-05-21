import { describe, it, expect } from 'vitest';
import { parseHeroJson, buildHeroUserPrompt, HERO_SYSTEM_PROMPT } from '../hero-llm';
import { buildMemoFromAudit } from '../v3-synth';
import type { AuditResult, CheckResult } from '../engine';

function mkAudit(checks: CheckResult[]): AuditResult {
  return {
    url: 'https://acme.test',
    hostname: 'acme.test',
    fetchedAt: new Date().toISOString(),
    durationMs: 100,
    checks,
    scoreNumeric: checks.filter((c) => c.passed).length,
    scoreMax: checks.length,
    scorePercent: 50,
    band: 'weak',
    bandLabel: 'Weak signal',
    bandKicker: 'acme.test is partially readable.',
    verdict: {
      crawl: { grade: 'C', passed: 0, total: 0 },
      schema: { grade: 'C', passed: 0, total: 0 },
      aeo: { grade: 'C', passed: 0, total: 0 },
      sendReady: { grade: 'C', passed: 0, total: 0 },
    },
  };
}

const memo = buildMemoFromAudit(
  mkAudit([
    {
      id: 'org-schema',
      category: 'schema',
      label: 'Organization JSON-LD on homepage',
      passed: false,
      weight: 2,
      evidence: 'no Organization schema',
      finding: 'No Organization schema on the homepage.',
      reliability: 'soft-absence',
    },
  ]),
);

describe('parseHeroJson', () => {
  it('parses a clean three-field JSON object', () => {
    const r = parseHeroJson(
      JSON.stringify({
        page_hero: 'You have a lead problem.',
        dm_one_liner: 'Quick one, Robert.',
        strength: 'Your site is fast.',
      }),
    );
    expect(r).not.toBeNull();
    expect(r?.pageHero).toBe('You have a lead problem.');
    expect(r?.dmOneLiner).toBe('Quick one, Robert.');
    expect(r?.strength).toBe('Your site is fast.');
  });

  it('parses JSON wrapped in a markdown fence and preamble', () => {
    const r = parseHeroJson(
      'Here is the hero:\n```json\n{"page_hero":"A.","dm_one_liner":"B.","strength":"C."}\n```',
    );
    expect(r?.pageHero).toBe('A.');
  });

  it('returns null when a field is missing', () => {
    expect(parseHeroJson(JSON.stringify({ page_hero: 'A.', dm_one_liner: 'B.' }))).toBeNull();
  });

  it('returns null when a field is blank', () => {
    expect(
      parseHeroJson(JSON.stringify({ page_hero: 'A.', dm_one_liner: '   ', strength: 'C.' })),
    ).toBeNull();
  });

  it('returns null on a non-JSON refusal', () => {
    expect(parseHeroJson('I cannot help with that.')).toBeNull();
  });

  it('scrubs em dashes and banned words the prompt forbids', () => {
    const r = parseHeroJson(
      JSON.stringify({
        page_hero: 'You run ads — but the page is slow.',
        dm_one_liner: 'Robust tracking, weak funnel.',
        strength: 'Clean stack.',
      }),
    );
    expect(r?.pageHero).toBe('You run ads, but the page is slow.');
    expect(r?.dmOneLiner).toBe('solid tracking, weak funnel.');
  });
});

describe('buildHeroUserPrompt', () => {
  it('includes the audit JSON and the company line', () => {
    const p = buildHeroUserPrompt({ memo });
    expect(p).toContain('acme.test');
    expect(p).toContain('AUDIT_JSON:');
    expect(p).toContain('"dimension"');
  });

  it('falls back to "Not available." for absent context fields', () => {
    const p = buildHeroUserPrompt({ memo });
    expect(p).toContain('INDUSTRY_CONTEXT:\nNot available.');
    expect(p).toContain('REVENUE_ESTIMATE:\nNot available.');
  });

  it('includes the industry context when supplied', () => {
    const p = buildHeroUserPrompt({ memo, industryContext: 'Roofers buy on trust and speed.' });
    expect(p).toContain('Roofers buy on trust and speed.');
  });
});

describe('HERO_SYSTEM_PROMPT', () => {
  it('carries the reliability calibration rule and the no-pitch rule', () => {
    expect(HERO_SYSTEM_PROMPT).toContain('soft-absence');
    expect(HERO_SYSTEM_PROMPT).toContain('Do not pitch');
  });
});

import { describe, it, expect } from 'vitest';
import { checkAiBotsBlocked } from '../robots';

describe('checkAiBotsBlocked', () => {
  it('the original false positive: Bing blocked at root, GPTBot only on /admin', () => {
    // The old flat regex reported this as "AI bots blocked" because an AI
    // user-agent appeared somewhere and a "Disallow: /" appeared somewhere
    // else. Per-block parsing must read it as allowed.
    const txt = [
      'User-agent: Bingbot',
      'Disallow: /',
      '',
      'User-agent: GPTBot',
      'Disallow: /admin',
    ].join('\n');
    const r = checkAiBotsBlocked(txt);
    expect(r.blocked).toBe(false);
    expect(r.blockedBots).toEqual([]);
  });

  it('a path disallow is not a block - only root counts', () => {
    const txt = ['User-agent: GPTBot', 'Disallow: /private/', 'Disallow: /admin'].join('\n');
    expect(checkAiBotsBlocked(txt).blocked).toBe(false);
  });

  it('an explicit AI-bot root disallow is a block', () => {
    const txt = ['User-agent: GPTBot', 'Disallow: /'].join('\n');
    const r = checkAiBotsBlocked(txt);
    expect(r.blocked).toBe(true);
    expect(r.blockedBots).toEqual(['gptbot']);
    expect(r.viaWildcardOnly).toBe(false);
  });

  it('consecutive user-agent lines share one rule group', () => {
    const txt = ['User-agent: GPTBot', 'User-agent: ClaudeBot', 'Disallow: /'].join('\n');
    const r = checkAiBotsBlocked(txt);
    expect(r.blockedBots).toEqual(expect.arrayContaining(['gptbot', 'claudebot']));
    expect(r.blockedBots).toHaveLength(2);
  });

  it('a blanket wildcard root block blocks AI bots too, flagged as wildcard-only', () => {
    const txt = ['User-agent: *', 'Disallow: /'].join('\n');
    const r = checkAiBotsBlocked(txt);
    expect(r.blocked).toBe(true);
    expect(r.blockedBots).toHaveLength(5);
    expect(r.viaWildcardOnly).toBe(true);
  });

  it('a specific AI-bot group overrides the wildcard block for that bot', () => {
    // RFC 9309: the most specific matching group wins. GPTBot has its own
    // (permissive) group, so only the other AI bots inherit the * block.
    const txt = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: GPTBot',
      'Disallow: /admin',
    ].join('\n');
    const r = checkAiBotsBlocked(txt);
    expect(r.blocked).toBe(true);
    expect(r.blockedBots).not.toContain('gptbot');
    expect(r.blockedBots).toContain('claudebot');
  });

  it('an Allow: / in the same group wins back access', () => {
    const txt = ['User-agent: GPTBot', 'Disallow: /', 'Allow: /'].join('\n');
    expect(checkAiBotsBlocked(txt).blocked).toBe(false);
  });

  it('handles comments, blank lines, and mixed case', () => {
    const txt = [
      '# block the AI crawlers',
      'USER-AGENT: gptbot  # OpenAI',
      'DISALLOW: /',
    ].join('\n');
    const r = checkAiBotsBlocked(txt);
    expect(r.blocked).toBe(true);
    expect(r.blockedBots).toEqual(['gptbot']);
  });

  it('empty or permissive files block nothing', () => {
    expect(checkAiBotsBlocked('').blocked).toBe(false);
    expect(checkAiBotsBlocked('User-agent: *\nDisallow:').blocked).toBe(false);
    expect(checkAiBotsBlocked('User-agent: *\nAllow: /').blocked).toBe(false);
  });
});

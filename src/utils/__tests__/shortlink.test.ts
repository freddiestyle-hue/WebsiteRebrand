import { describe, it, expect } from 'vitest';
import {
  generateCode,
  sanitizeCustomCode,
  isBotUserAgent,
  appendUtmParams,
} from '../shortlink';

/**
 * Upgrade 13 - URL shortener. Pure-function tests for the parts that don't
 * touch KV or PostHog. The createShortLink / resolveShortLink / trackClick
 * functions are KV-bound and tested via integration on the deployed
 * endpoint (the existing bun/vitest compat issue makes mocking Upstash
 * unreliable - see crawl.test.ts for the same issue).
 */

describe('generateCode (Upgrade 13)', () => {
  it('generates a 4-char base36 code by default', () => {
    const code = generateCode();
    expect(code).toHaveLength(4);
    expect(code).toMatch(/^[a-z0-9]{4}$/);
  });

  it('generates a different code each call (non-degenerate randomness)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(generateCode());
    }
    // 50 random 4-char base36 codes should give us >= 49 uniques in practice
    // (collision odds at this sample size are ~0.0007). If we get fewer than
    // 48 uniques the RNG is degenerate.
    expect(codes.size).toBeGreaterThanOrEqual(48);
  });

  it('respects custom length', () => {
    expect(generateCode(6)).toHaveLength(6);
    expect(generateCode(2)).toHaveLength(2);
    expect(generateCode(10)).toHaveLength(10);
  });
});

describe('sanitizeCustomCode (Upgrade 13)', () => {
  it('lowercases and keeps alphanumerics + hyphens', () => {
    expect(sanitizeCustomCode('Claire-Spok')).toBe('claire-spok');
    expect(sanitizeCustomCode('WAVE1-Q3')).toBe('wave1-q3');
  });

  it('strips disallowed characters (spaces, punctuation, special chars)', () => {
    expect(sanitizeCustomCode('claire spok')).toBe('clairespok');
    expect(sanitizeCustomCode('claire@spok')).toBe('clairespok');
    expect(sanitizeCustomCode('claire/spok')).toBe('clairespok');
    expect(sanitizeCustomCode('claire.spok')).toBe('clairespok');
  });

  it('caps at 32 chars', () => {
    const long = 'a'.repeat(50);
    const result = sanitizeCustomCode(long);
    expect(result).toHaveLength(32);
  });

  it('rejects too-short input (< 2 chars after sanitize)', () => {
    expect(sanitizeCustomCode('a')).toBeNull();
    expect(sanitizeCustomCode('')).toBeNull();
    expect(sanitizeCustomCode('!!!')).toBeNull(); // empty after sanitize
  });

  it('rejects null / undefined / non-string input', () => {
    expect(sanitizeCustomCode(null)).toBeNull();
    expect(sanitizeCustomCode(undefined)).toBeNull();
    // @ts-expect-error - intentionally testing wrong type
    expect(sanitizeCustomCode(42)).toBeNull();
  });
});

describe('isBotUserAgent (Upgrade 13)', () => {
  describe('bot user agents (return true)', () => {
    it.each([
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; +http://www.linkedin.com/)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Facebot Twitterbot/1.0',
      'Slackbot 1.0 (+https://api.slack.com/robots)',
      'Twitterbot/1.0',
      'WhatsApp/2.21.12.21 A',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'redditbot/1.0',
      'Tumblr/14.0.835.186 iPhone',
      'Embedly/0.2 (+http://support.embed.ly/)',
      'iframely',
      'Mozilla/5.0 (Macintosh; Mozilla/5.0 LinkPreview)',
      'unfurl-service/1.0',
      'Mozilla/5.0 (something) bot/1.0',
      'YandexBot/3.0 (+http://yandex.com/bots) - spider',
      'archive.org_bot',
    ])('detects "%s" as a bot', (ua) => {
      expect(isBotUserAgent(ua)).toBe(true);
    });
  });

  describe('human user agents (return false)', () => {
    it.each([
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      'Mozilla/5.0 (Macintosh) AppleWebKit Safari/605',
    ])('does NOT flag "%s" as a bot', (ua) => {
      expect(isBotUserAgent(ua)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles null and undefined and empty string', () => {
      expect(isBotUserAgent(null)).toBe(false);
      expect(isBotUserAgent(undefined)).toBe(false);
      expect(isBotUserAgent('')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isBotUserAgent('LINKEDINBOT')).toBe(true);
      expect(isBotUserAgent('LinkedInBot')).toBe(true);
      expect(isBotUserAgent('linkedinbot')).toBe(true);
    });
  });
});

describe('appendUtmParams (Upgrade 13)', () => {
  const baseTarget = 'https://rivett.tech/audit/v3/spok-com';

  it('appends utm_source + utm_campaign + utm_recipient when all meta present', () => {
    const result = appendUtmParams(
      baseTarget,
      {
        target: baseTarget,
        channel: 'linkedin_dm',
        campaign: 'wave1',
        recipient: 'claire',
      },
      'k3x9',
    );
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBe('linkedin_dm');
    expect(url.searchParams.get('utm_campaign')).toBe('wave1');
    expect(url.searchParams.get('utm_recipient')).toBe('claire');
    expect(url.searchParams.get('utm_medium')).toBe('outreach');
    expect(url.searchParams.get('utm_content')).toBe('k3x9');
    expect(url.searchParams.get('via')).toBe('shortlink');
    expect(url.searchParams.get('rl')).toBe('k3x9');
    expect(url.searchParams.get('r')).toBe('k3x9');
  });

  it('omits optional UTM params when meta is missing', () => {
    const result = appendUtmParams(baseTarget, { target: baseTarget }, 'k3x9');
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBeNull();
    expect(url.searchParams.get('utm_campaign')).toBeNull();
    expect(url.searchParams.get('utm_recipient')).toBeNull();
    // Required-by-design params still set:
    expect(url.searchParams.get('utm_medium')).toBe('outreach');
    expect(url.searchParams.get('utm_content')).toBe('k3x9');
    expect(url.searchParams.get('via')).toBe('shortlink');
    expect(url.searchParams.get('rl')).toBe('k3x9');
    expect(url.searchParams.get('r')).toBe('k3x9');
  });

  it('defaults utm_medium to outreach when no medium is given (DMs, cold email)', () => {
    const result = appendUtmParams(
      baseTarget,
      { target: baseTarget, channel: 'linkedin_dm', campaign: 'wave1' },
      'k3x9',
    );
    expect(new URL(result).searchParams.get('utm_medium')).toBe('outreach');
  });

  it('uses an explicit medium when provided (blog/social shares are not outreach)', () => {
    const result = appendUtmParams(
      baseTarget,
      { target: baseTarget, channel: 'linkedin_post', campaign: 'my-post', medium: 'social' },
      'k3x9',
    );
    const url = new URL(result);
    expect(url.searchParams.get('utm_medium')).toBe('social');
    expect(url.searchParams.get('utm_source')).toBe('linkedin_post');
    expect(url.searchParams.get('utm_campaign')).toBe('my-post');
  });

  it('preserves existing query params on the target URL', () => {
    const withParams = `${baseTarget}?ref=manual&existing=1`;
    const result = appendUtmParams(withParams, { target: withParams, campaign: 'wave1' }, 'k3x9');
    const url = new URL(result);
    expect(url.searchParams.get('ref')).toBe('manual');
    expect(url.searchParams.get('existing')).toBe('1');
    expect(url.searchParams.get('utm_campaign')).toBe('wave1');
  });

  it('overwrites existing UTM params (shortlink attribution wins)', () => {
    const withStaleUtm = `${baseTarget}?utm_source=old_source&utm_campaign=old_campaign&utm_content=old_code&r=old`;
    const result = appendUtmParams(
      withStaleUtm,
      { target: withStaleUtm, channel: 'linkedin_dm', campaign: 'wave1' },
      'k3x9',
    );
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBe('linkedin_dm');
    expect(url.searchParams.get('utm_campaign')).toBe('wave1');
    expect(url.searchParams.get('utm_content')).toBe('k3x9');
    expect(url.searchParams.get('r')).toBe('k3x9');
    expect(url.searchParams.get('rl')).toBe('k3x9');
  });

  it('returns the original URL unchanged when target is malformed', () => {
    const bad = 'not-a-url';
    expect(appendUtmParams(bad, { target: bad, campaign: 'wave1' }, 'k3x9')).toBe(bad);
  });

  it('handles trailing fragments on the target URL', () => {
    const withHash = `${baseTarget}#section`;
    const result = appendUtmParams(withHash, { target: withHash, campaign: 'wave1' }, 'k3x9');
    const url = new URL(result);
    expect(url.hash).toBe('#section');
    expect(url.searchParams.get('utm_campaign')).toBe('wave1');
  });
});

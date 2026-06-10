import { describe, expect, it } from 'vitest';
import { classifyUserAgent } from '../botClassifier';

describe('classifyUserAgent', () => {
  it('returns null for real desktop Chrome', () => {
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      ),
    ).toBeNull();
  });

  it('returns null for iPhone Safari', () => {
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBeNull();
  });

  it('flags a missing user agent as automation', () => {
    expect(classifyUserAgent('')).toEqual({ botType: 'unknown_bot', botName: 'no-user-agent' });
    expect(classifyUserAgent(null)).toEqual({ botType: 'unknown_bot', botName: 'no-user-agent' });
  });

  it('classifies live LLM fetches as llm_user_fetch', () => {
    expect(
      classifyUserAgent(
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
      )?.botType,
    ).toBe('llm_user_fetch');
    expect(classifyUserAgent('Claude-User/1.0')?.botType).toBe('llm_user_fetch');
    expect(classifyUserAgent('Perplexity-User/1.0')?.botType).toBe('llm_user_fetch');
  });

  it('classifies AI crawlers as llm_crawler', () => {
    expect(
      classifyUserAgent('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot')
        ?.botType,
    ).toBe('llm_crawler');
    expect(
      classifyUserAgent('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')?.botType,
    ).toBe('llm_crawler');
    expect(classifyUserAgent('Mozilla/5.0 (compatible; PerplexityBot/1.0)')?.botType).toBe('llm_crawler');
  });

  it('ChatGPT-User wins over GPTBot-style generic matching', () => {
    const m = classifyUserAgent('ChatGPT-User/1.0 (compatible; bot)');
    expect(m?.botType).toBe('llm_user_fetch');
  });

  it('classifies LinkedIn preview separately from other unfurlers', () => {
    expect(
      classifyUserAgent('LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)')?.botType,
    ).toBe('linkedin_preview');
    expect(classifyUserAgent('Slackbot-LinkExpanding 1.0')?.botType).toBe('preview_bot');
    expect(classifyUserAgent('WhatsApp/2.23.20')?.botType).toBe('preview_bot');
  });

  it('classifies declared email scanners', () => {
    expect(classifyUserAgent('Mozilla/5.0 (compatible; Proofpoint URL Defense)')?.botType).toBe('email_scanner');
    expect(classifyUserAgent('MimecastClick/1.0')?.botType).toBe('email_scanner');
  });

  it('classifies search and SEO crawlers', () => {
    expect(
      classifyUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')?.botType,
    ).toBe('search_crawler');
    expect(classifyUserAgent('Mozilla/5.0 (compatible; AhrefsBot/7.0)')?.botType).toBe('search_crawler');
  });

  it('classifies admitted headless browsers', () => {
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.0.0 Safari/537.36',
      )?.botType,
    ).toBe('headless');
  });

  it('catches generic http clients', () => {
    expect(classifyUserAgent('curl/8.4.0')?.botType).toBe('unknown_bot');
    expect(classifyUserAgent('python-requests/2.31.0')?.botType).toBe('unknown_bot');
  });
});

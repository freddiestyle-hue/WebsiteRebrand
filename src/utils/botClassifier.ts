/**
 * Classifies inbound requests by user agent into bot families before any
 * client JS runs. Most non-human traffic (LLM fetchers, link previewers,
 * search crawlers) never executes posthog-js, so this server-side tag is the
 * only place it becomes visible.
 *
 * Disguised email scanners (SafeLinks, Mimecast) run real Chrome with clean
 * user agents and are NOT caught here - they are caught by the behavioral
 * timing predicate in the HQ query layer. This module only classifies bots
 * that declare themselves.
 */

export type BotType =
  | 'llm_user_fetch' // a human asked an AI to read this page right now
  | 'llm_crawler' // AI training/index crawler
  | 'linkedin_preview'
  | 'preview_bot' // Slack/Teams/WhatsApp/etc. unfurling a link
  | 'search_crawler'
  | 'email_scanner' // declared security scanners only
  | 'headless' // admits to being automation
  | 'unknown_bot';

export interface BotMatch {
  botType: BotType;
  botName: string;
}

interface Rule {
  pattern: RegExp;
  botType: BotType;
  botName: string;
}

// Order matters: first match wins. Specific before generic.
const RULES: Rule[] = [
  // A human is on the other end of these, asking an AI about this page.
  { pattern: /ChatGPT-User/i, botType: 'llm_user_fetch', botName: 'chatgpt-user' },
  { pattern: /Claude-User/i, botType: 'llm_user_fetch', botName: 'claude-user' },
  { pattern: /Perplexity-User/i, botType: 'llm_user_fetch', botName: 'perplexity-user' },

  // AI crawlers (training corpora + AI search indexes).
  { pattern: /GPTBot/i, botType: 'llm_crawler', botName: 'gptbot' },
  { pattern: /OAI-SearchBot/i, botType: 'llm_crawler', botName: 'oai-searchbot' },
  { pattern: /ClaudeBot|Claude-SearchBot|anthropic-ai/i, botType: 'llm_crawler', botName: 'claudebot' },
  { pattern: /PerplexityBot/i, botType: 'llm_crawler', botName: 'perplexitybot' },
  { pattern: /Google-Extended/i, botType: 'llm_crawler', botName: 'google-extended' },
  { pattern: /Bytespider/i, botType: 'llm_crawler', botName: 'bytespider' },
  { pattern: /CCBot/i, botType: 'llm_crawler', botName: 'ccbot' },
  { pattern: /cohere-ai|cohere-training/i, botType: 'llm_crawler', botName: 'cohere' },
  { pattern: /meta-externalagent/i, botType: 'llm_crawler', botName: 'meta-ai' },
  { pattern: /Applebot-Extended/i, botType: 'llm_crawler', botName: 'applebot-extended' },
  { pattern: /mistralai-user|MistralAI/i, botType: 'llm_crawler', botName: 'mistral' },

  { pattern: /LinkedInBot/i, botType: 'linkedin_preview', botName: 'linkedinbot' },

  // Chat/social link unfurlers. Fire when someone pastes a link into a chat.
  { pattern: /Slackbot|Slack-ImgProxy/i, botType: 'preview_bot', botName: 'slack' },
  { pattern: /facebookexternalhit|facebookcatalog/i, botType: 'preview_bot', botName: 'facebook' },
  { pattern: /Twitterbot/i, botType: 'preview_bot', botName: 'twitter' },
  { pattern: /WhatsApp/i, botType: 'preview_bot', botName: 'whatsapp' },
  { pattern: /TelegramBot/i, botType: 'preview_bot', botName: 'telegram' },
  { pattern: /Discordbot/i, botType: 'preview_bot', botName: 'discord' },
  { pattern: /SkypeUriPreview|MicrosoftPreview/i, botType: 'preview_bot', botName: 'microsoft-preview' },
  { pattern: /Iframely|Embedly/i, botType: 'preview_bot', botName: 'embed-service' },

  // Declared email security scanners. The disguised ones bypass this list.
  { pattern: /MimecastClick|Mimecast/i, botType: 'email_scanner', botName: 'mimecast' },
  { pattern: /Proofpoint/i, botType: 'email_scanner', botName: 'proofpoint' },
  { pattern: /Barracuda/i, botType: 'email_scanner', botName: 'barracuda' },
  { pattern: /TrendMicro|Trend Micro/i, botType: 'email_scanner', botName: 'trendmicro' },
  { pattern: /Symantec|BlueCoat/i, botType: 'email_scanner', botName: 'symantec' },

  { pattern: /Googlebot|Google-InspectionTool|Storebot-Google/i, botType: 'search_crawler', botName: 'googlebot' },
  { pattern: /bingbot|BingPreview/i, botType: 'search_crawler', botName: 'bingbot' },
  { pattern: /DuckDuckBot/i, botType: 'search_crawler', botName: 'duckduckbot' },
  { pattern: /Applebot/i, botType: 'search_crawler', botName: 'applebot' },
  { pattern: /YandexBot|Baiduspider/i, botType: 'search_crawler', botName: 'other-search' },
  { pattern: /AhrefsBot|SemrushBot|MJ12bot|DotBot|DataForSeoBot|Screaming Frog/i, botType: 'search_crawler', botName: 'seo-crawler' },

  // Admits to being automation.
  { pattern: /HeadlessChrome|PhantomJS|Playwright|Puppeteer|Selenium/i, botType: 'headless', botName: 'headless-browser' },

  // Generic tells, last.
  { pattern: /\b(bot|crawler|spider|scraper)\b/i, botType: 'unknown_bot', botName: 'generic-bot' },
  { pattern: /curl|wget|python-requests|python-urllib|aiohttp|go-http-client|okhttp|libwww|axios|node-fetch|Java\//i, botType: 'unknown_bot', botName: 'http-client' },
];

/** Returns a match for declared bots, or null for (presumed) humans. */
export function classifyUserAgent(userAgent: string | null | undefined): BotMatch | null {
  if (!userAgent || userAgent.trim() === '') {
    // Real browsers always send a UA. An empty one is automation.
    return { botType: 'unknown_bot', botName: 'no-user-agent' };
  }
  for (const rule of RULES) {
    if (rule.pattern.test(userAgent)) {
      return { botType: rule.botType, botName: rule.botName };
    }
  }
  return null;
}

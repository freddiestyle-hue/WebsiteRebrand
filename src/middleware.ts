import { defineMiddleware } from 'astro:middleware';
import { classifyUserAgent } from './utils/botClassifier';
import { captureServerEvent } from './utils/posthog/capture';

/**
 * Tags declared-bot traffic (LLM fetchers, link previewers, crawlers,
 * declared email scanners) with a server-side `bot_visit` PostHog event.
 * These clients don't execute posthog-js, so without this tap they are
 * invisible to analytics. Humans pass through with zero added work.
 */

const SKIP_PREFIXES = ['/api/', '/_astro/', '/_image', '/_server-islands/'];
// Static assets requested directly (favicon, fonts, og images, sitemap...).
const ASSET_EXT = /\.(js|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|txt|xml|json|webmanifest|map|pdf)$/i;

// During `astro build` the middleware runs once per prerendered route with a
// synthetic request; touching headers there only emits warnings. Vercel's
// edge runtime has no npm_lifecycle_event, so this is false at runtime.
const IS_BUILD_PHASE =
  typeof process !== 'undefined' && process.env?.npm_lifecycle_event === 'build';

export const onRequest = defineMiddleware(async (context, next) => {
  if (IS_BUILD_PHASE) return next();

  const { request } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') return next();

  const path = context.url.pathname;
  if (SKIP_PREFIXES.some((p) => path.startsWith(p)) || ASSET_EXT.test(path)) return next();

  // During `astro build`, middleware runs for prerendered routes with no real
  // client behind the request. Vercel runtime requests always carry
  // x-forwarded-for; its absence means build time (or local dev) - skip.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (!forwardedFor) return next();

  const userAgent = request.headers.get('user-agent');
  const match = classifyUserAgent(userAgent);
  if (!match) return next();

  const search = context.url.searchParams;
  // Bots get a stable-ish per-type distinct_id; profiles are disabled so
  // they never pollute the persons table.
  await captureServerEvent({
    event: 'bot_visit',
    distinctId: `bot:${match.botName}`,
    properties: {
      $process_person_profile: false,
      bot_type: match.botType,
      bot_name: match.botName,
      bot_user_agent: userAgent,
      path,
      utm_source: search.get('utm_source') || undefined,
      utm_campaign: search.get('utm_campaign') || undefined,
      utm_recipient: search.get('utm_recipient') || undefined,
      referer: request.headers.get('referer') || undefined,
      ip_country: request.headers.get('x-vercel-ip-country') || undefined,
      ip_city: request.headers.get('x-vercel-ip-city') || undefined,
    },
  });

  return next();
});

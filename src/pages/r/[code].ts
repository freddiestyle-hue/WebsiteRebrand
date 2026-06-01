// Shortlink redirect endpoint (Upgrade 13). GET /r/{code} looks up the code
// in Upstash KV, fires a PostHog `short_link_clicked` event server-side (so
// even bouncers who close the tab immediately get tracked), then 302s to the
// target URL with UTM params appended.
//
// Bot user agents (LinkedIn / Slack / etc. unfurling OG previews) are still
// redirected but counted separately in `bot_click_count` and NOT fired into
// PostHog. Without this filter, every shared link would log 1-3 fake "clicks"
// from the unfurl bots before any human ever sees it.
//
// Fall-through behaviour: if the code is unknown, 302 to /audit/v3 (the audit
// form landing) so a typo in a DM doesn't return a 404 to a real prospect.

import type { APIRoute } from 'astro';
import { resolveShortLink, trackClick, appendUtmParams, isBotUserAgent } from '../../utils/shortlink';

export const prerender = false;

const POSTHOG_HOST = 'https://us.i.posthog.com';
// Public client token - safe to embed. Same key the in-browser PostHog uses.
const POSTHOG_CLIENT_KEY = 'phc_vqst8XDELjjTmFYwJiqzD7PzazzyQ9J69WJmcfJoxt27';

// Fire-and-forget server-side event. Doesn't block the redirect on PostHog
// being slow or down. Captures the click context (campaign, recipient,
// channel, code, target_path) plus IP/UA-derived geo for /hq Action Queue.
async function captureClickEvent(opts: {
  code: string;
  meta: { target: string; campaign?: string; recipient?: string; channel?: string; medium?: string };
  userAgent: string;
  ip: string | null;
  referer: string | null;
}): Promise<void> {
  let targetPath = '';
  try {
    targetPath = new URL(opts.meta.target).pathname;
  } catch {
    targetPath = opts.meta.target;
  }
  const event = {
    api_key: POSTHOG_CLIENT_KEY,
    event: 'short_link_clicked',
    // distinct_id falls back to a synthetic IP-based ID. Once the user lands
    // on the audit page, the in-browser PostHog snippet generates the proper
    // $device_id and merges; this server event is a head-start, not the only
    // record.
    distinct_id: opts.ip || `anon_${opts.code}`,
    properties: {
      $current_url: `https://rivett.tech/r/${opts.code}`,
      rl_code: opts.code,
      rl_target: opts.meta.target,
      rl_target_path: targetPath,
      rl_campaign: opts.meta.campaign ?? null,
      rl_recipient: opts.meta.recipient ?? null,
      rl_channel: opts.meta.channel ?? null,
      rl_medium: opts.meta.medium ?? null,
      $ip: opts.ip ?? undefined,
      $user_agent: opts.userAgent,
      $referrer: opts.referer ?? '$direct',
      // Stamp this as a server-side fire so it's filterable in PostHog.
      source: 'shortlink_server',
    },
    timestamp: new Date().toISOString(),
  };
  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      // Don't wait forever - the redirect is the user-facing thing.
      signal: AbortSignal.timeout(2000),
    });
  } catch (e) {
    console.error('[shortlink] PostHog capture failed', e);
  }
}

export const GET: APIRoute = async ({ params, request, redirect }) => {
  const code = params.code ?? '';
  const record = await resolveShortLink(code);

  // Unknown code: redirect to the audit form rather than 404. A bad URL in a
  // DM shouldn't dead-end a real prospect.
  if (!record) {
    return redirect('/audit/v3', 302);
  }

  const userAgent = request.headers.get('user-agent') ?? '';
  const referer = request.headers.get('referer');
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;
  const isBot = isBotUserAgent(userAgent);

  // Bot path: increment the bot counter, skip the PostHog event. Still
  // redirect so the unfurl preview gets the OG card from the target page.
  if (isBot) {
    trackClick(code, true).catch((e) => console.error('[shortlink] bot trackClick failed', e));
  } else {
    // Human path: fire PostHog + increment human counter. Both fire-and-forget
    // so the redirect isn't blocked.
    captureClickEvent({
      code,
      meta: {
        target: record.target,
        campaign: record.campaign,
        recipient: record.recipient,
        channel: record.channel,
        medium: record.medium,
      },
      userAgent,
      ip,
      referer,
    }).catch((e) => console.error('[shortlink] capture failed', e));
    trackClick(code, false).catch((e) => console.error('[shortlink] trackClick failed', e));
  }

  // Append UTM params to the target URL so the destination page (audit, etc.)
  // captures the campaign/recipient/channel context in the in-browser PostHog
  // pageview event. The shortlink event above is a head-start; the pageview
  // event is the canonical record.
  const finalUrl = appendUtmParams(
    record.target,
    {
      target: record.target,
      campaign: record.campaign,
      recipient: record.recipient,
      channel: record.channel,
      medium: record.medium,
    },
    code,
  );

  return redirect(finalUrl, 302);
};

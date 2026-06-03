const POSTHOG_HOST =
  process.env.POSTHOG_CAPTURE_HOST ||
  import.meta.env.POSTHOG_CAPTURE_HOST ||
  'https://us.i.posthog.com';

// Public project key. Safe to use server-side for event capture; never use a
// personal API key here.
const POSTHOG_CLIENT_KEY =
  process.env.POSTHOG_CLIENT_KEY ||
  import.meta.env.POSTHOG_CLIENT_KEY ||
  'phc_vqst8XDELjjTmFYwJiqzD7PzazzyQ9J69WJmcfJoxt27';

export interface ServerPostHogEvent {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

export async function captureServerEvent(opts: ServerPostHogEvent): Promise<boolean> {
  if (!opts.event || !opts.distinctId) return false;

  try {
    const res = await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_CLIENT_KEY,
        event: opts.event,
        distinct_id: opts.distinctId,
        properties: opts.properties ?? {},
        timestamp: opts.timestamp ?? new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      console.error('[posthog] capture non-200', opts.event, res.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[posthog] capture failed', opts.event, error);
    return false;
  }
}


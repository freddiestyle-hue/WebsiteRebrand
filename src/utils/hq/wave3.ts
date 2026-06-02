// Wave 3 Huber campaign — live state assembled from Instantly + PostHog.
// Used by the /hq page to render the Wave 3 panel.
//
// Auth comes from env (INSTANTLY_API_KEY + POSTHOG_API_KEY). Fails soft —
// if either source is unreachable, returns partial data with zeros so /hq
// still renders.

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2';
const WAVE3_CAMPAIGN_ID = '2e066a65-7b19-451b-946e-4c039ea1c4ce';
const POSTHOG_BASE = 'https://us.posthog.com/api/projects/373899';
const CAMPAIGN_UTM = 'wave3-huber';
const TOTAL_LEADS = 45;

export interface Wave3State {
  campaign: {
    name: string;
    status: 'Active' | 'Paused' | 'Draft' | 'Unknown';
    statusCode: number;
    totalLeads: number;
    contactedLeads: number;
    sentEmails: number;
    inboxes: string[];
    scheduleTimezone: string;
  };
  delivery: {
    sent: number;
    bounced: number;
    delivered: number;
    deliveryRate: number;
  };
  engagement: {
    opensUnique: number;
    openRate: number;
    clicksUnique: number;
    clickRate: number;
    replies: number;
    replyRate: number;
    bookings: number;
    bookingRate: number;
  };
  variants: {
    aCount: number;
    bCount: number;
  };
  fetchedAt: string;
  errors: string[];
}

function instantlyKey(): string | null {
  return (process.env.INSTANTLY_API_KEY
    || import.meta.env.INSTANTLY_API_KEY
    || '').trim() || null;
}

function posthogKey(): string | null {
  return (process.env.POSTHOG_PROJECT_API_KEY
    || process.env.POSTHOG_PAT
    || import.meta.env.POSTHOG_PROJECT_API_KEY
    || import.meta.env.POSTHOG_PAT
    || '').trim() || null;
}

async function instantlyGet(path: string): Promise<any> {
  const key = instantlyKey();
  if (!key) throw new Error('INSTANTLY_API_KEY not set');
  const res = await fetch(`${INSTANTLY_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      'User-Agent': 'rivett-hq/1.0',
    },
  });
  if (!res.ok) throw new Error(`Instantly GET ${path} -> ${res.status}`);
  return res.json();
}

async function posthogQuery(sql: string): Promise<any[][]> {
  const key = posthogKey();
  if (!key) throw new Error('POSTHOG_PROJECT_API_KEY not set');
  const res = await fetch(`${POSTHOG_BASE}/query/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: { kind: 'HogQLQuery', query: sql },
    }),
  });
  if (!res.ok) throw new Error(`PostHog query -> ${res.status}`);
  const data = await res.json();
  return (data?.results as any[][]) || [];
}

const STATUS_LABELS: Record<number, Wave3State['campaign']['status']> = {
  0: 'Draft',
  1: 'Active',
  2: 'Paused',
};

function pct(num: number, denom: number, places = 1): number {
  if (!denom) return 0;
  return Math.round((100 * num / denom) * 10 ** places) / 10 ** places;
}

export async function fetchWave3State(): Promise<Wave3State> {
  const errors: string[] = [];
  const state: Wave3State = {
    campaign: {
      name: 'Wave 3 Huber outreach',
      status: 'Unknown',
      statusCode: 0,
      totalLeads: TOTAL_LEADS,
      contactedLeads: 0,
      sentEmails: 0,
      inboxes: [],
      scheduleTimezone: 'America/Chicago',
    },
    delivery: { sent: 0, bounced: 0, delivered: 0, deliveryRate: 0 },
    engagement: {
      opensUnique: 0, openRate: 0,
      clicksUnique: 0, clickRate: 0,
      replies: 0, replyRate: 0,
      bookings: 0, bookingRate: 0,
    },
    variants: { aCount: 19, bCount: 26 },
    fetchedAt: new Date().toISOString(),
    errors,
  };

  // Pull Instantly campaign + analytics in parallel.
  const [campaignR, analyticsR] = await Promise.allSettled([
    instantlyGet(`/campaigns/${WAVE3_CAMPAIGN_ID}`),
    instantlyGet(`/campaigns/analytics?ids=${WAVE3_CAMPAIGN_ID}`),
  ]);

  if (campaignR.status === 'fulfilled') {
    const c = campaignR.value;
    state.campaign.name = c.name || state.campaign.name;
    state.campaign.statusCode = c.status ?? 0;
    state.campaign.status = STATUS_LABELS[c.status] || 'Unknown';
    state.campaign.inboxes = c.email_list || [];
    const tz = c.campaign_schedule?.schedules?.[0]?.timezone;
    if (tz) state.campaign.scheduleTimezone = tz;
  } else {
    errors.push(`campaign: ${campaignR.reason}`);
  }

  if (analyticsR.status === 'fulfilled') {
    const a = Array.isArray(analyticsR.value)
      ? analyticsR.value[0] : analyticsR.value;
    if (a) {
      state.campaign.totalLeads = a.leads_count ?? TOTAL_LEADS;
      state.campaign.contactedLeads = a.contacted_count ?? 0;
      state.campaign.sentEmails = a.emails_sent_count ?? 0;
      state.delivery.sent = a.emails_sent_count ?? 0;
      state.delivery.bounced = a.bounced_count ?? 0;
      state.delivery.delivered = Math.max(
        0, state.delivery.sent - state.delivery.bounced);
      state.delivery.deliveryRate = pct(
        state.delivery.delivered, state.delivery.sent);
      state.engagement.opensUnique =
        a.open_count_unique ?? a.open_count ?? 0;
      state.engagement.openRate = pct(
        state.engagement.opensUnique, state.delivery.delivered);
      state.engagement.replies = a.reply_count ?? 0;
      state.engagement.replyRate = pct(
        state.engagement.replies, state.delivery.delivered);
    }
  } else {
    errors.push(`analytics: ${analyticsR.reason}`);
  }

  // PostHog: unique clicks + bookings filtered to wave3-huber.
  const clicksSQL = (
    "SELECT count(DISTINCT properties.rl_recipient) FROM events " +
    "WHERE event = 'short_link_clicked' " +
    `AND properties.rl_campaign = '${CAMPAIGN_UTM}' ` +
    "AND timestamp >= now() - INTERVAL 30 DAY"
  );
  const bookingsSQL = (
    "SELECT count() FROM events WHERE event = 'call_booked' " +
    `AND (properties.utm_campaign = '${CAMPAIGN_UTM}' ` +
    `OR properties.rl_campaign = '${CAMPAIGN_UTM}') ` +
    "AND timestamp >= now() - INTERVAL 30 DAY"
  );

  const [clicksR, bookingsR] = await Promise.allSettled([
    posthogQuery(clicksSQL),
    posthogQuery(bookingsSQL),
  ]);

  if (clicksR.status === 'fulfilled' && clicksR.value?.[0]) {
    state.engagement.clicksUnique = Number(clicksR.value[0][0] || 0);
    state.engagement.clickRate = pct(
      state.engagement.clicksUnique, state.delivery.delivered);
  } else if (clicksR.status === 'rejected') {
    errors.push(`posthog clicks: ${clicksR.reason}`);
  }

  if (bookingsR.status === 'fulfilled' && bookingsR.value?.[0]) {
    state.engagement.bookings = Number(bookingsR.value[0][0] || 0);
    state.engagement.bookingRate = pct(
      state.engagement.bookings, state.delivery.delivered, 2);
  } else if (bookingsR.status === 'rejected') {
    errors.push(`posthog bookings: ${bookingsR.reason}`);
  }

  return state;
}

// Cron-triggered Instantly -> HQ engagement sync.
//
// WHY: HQ (Airtable) had no way to see Instantly engagement. Prospects sat at
// "Drafted" stage in HQ while Instantly had sent them an email and they'd
// opened it three times. PostHog had a separate (proxaction-inflated) view.
// Three sources of truth, none of them aligned.
//
// HOW: Every 10 min Vercel pings this endpoint. We list every Instantly
// campaign, paginate the leads in each, and for each lead with a matching
// email in Airtable we:
//   1. Diff Instantly's opens/clicks/replies against Airtable's stored counts.
//   2. Fire one PostHog event per net-new open / click / reply, attributed to
//      the same prospect slug PostHog already uses for memo views (so the
//      timelines join).
//   3. Update Airtable: new counts, Last Engaged At, and one-way stage
//      advancement (Sent on first send, Replied on first reply; never
//      regress past a manual Booked / Won).
//
// AUTH: Vercel cron sends Authorization: Bearer ${CRON_SECRET}. Without it
// the endpoint refuses. The manual operator-trigger form is the same header.
//
// IDEMPOTENCY: counts come from Instantly's per-lead totals. If we re-run
// before any new activity, deltas are zero and we write nothing. If we miss
// a run (Vercel hiccup), the next run catches up because we compare against
// Airtable, not against a stored "last-seen" cursor.

import type { APIRoute } from 'astro';
import {
  getProspectsByEmail,
  updateProspectEngagementBatch,
  type ProspectEngagementUpdate,
  type ProspectInfo,
} from '../../../utils/hq/airtable';
import { captureServerEvent } from '../../../utils/posthog/capture';

export const prerender = false;

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2';
const PAGE_SIZE = 100;
// Hobby plan cap is 60s. Per-page Instantly call is fast (~200-500ms) so we
// have plenty of room, but bound iterations defensively in case a campaign
// has thousands of leads.
const MAX_LEADS_PER_CAMPAIGN = 1000;

interface InstantlyCampaign {
  id: string;
  name: string;
  status: number; // 1 = active
}

interface InstantlyLead {
  id: string;
  email: string;
  campaign: string;
  email_open_count?: number;
  email_click_count?: number;
  email_reply_count?: number;
  timestamp_last_contact?: string;
  timestamp_last_open?: string;
  timestamp_last_touch?: string;
  status_summary?: {
    lastStep?: {
      timestamp_executed?: string;
    };
  };
}

export const GET: APIRoute = async ({ request, url }) => {
  const expected = (process.env.CRON_SECRET || '').trim();
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (expected && bearer !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const apiKey = (process.env.INSTANTLY_API_KEY || '').trim();
  if (!apiKey) {
    return json({ ok: false, error: 'INSTANTLY_API_KEY not set' }, 500);
  }

  const started = Date.now();
  const dryRun = url.searchParams.get('dry_run') === '1';

  // Pull email -> ProspectInfo from Airtable once. Cached for 30 min by the
  // upstream utility, so multiple runs in a window share one fetch.
  const byEmail = await getProspectsByEmail();
  if (byEmail.size === 0) {
    return json({ ok: false, error: 'Airtable returned 0 prospects (no PAT?)' }, 500);
  }

  // List active campaigns. Inactive campaigns still get paged (paused != ended)
  // so historical engagement keeps flowing.
  let campaigns: InstantlyCampaign[];
  try {
    campaigns = await listCampaigns(apiKey);
  } catch (e) {
    return json({ ok: false, error: `campaigns: ${String(e)}` }, 500);
  }

  let totalLeads = 0;
  let matchedLeads = 0;
  let opensFired = 0;
  let clicksFired = 0;
  let repliesFired = 0;
  const updates: ProspectEngagementUpdate[] = [];
  const perCampaign: Array<{ id: string; name: string; leads: number; matched: number }> = [];

  for (const campaign of campaigns) {
    let scanned = 0;
    let matched = 0;
    let cursor: string | undefined;
    do {
      const page = await fetchLeadsPage(apiKey, campaign.id, cursor);
      if (!page) break;
      for (const lead of page.items) {
        scanned += 1;
        totalLeads += 1;
        const email = (lead.email || '').trim().toLowerCase();
        if (!email) continue;
        const prospect = byEmail.get(email);
        if (!prospect) continue;
        matched += 1;
        matchedLeads += 1;

        const update = buildUpdate(prospect, lead, campaign);
        if (update.update) updates.push(update.update);

        // Fire one PostHog event per net-new engagement. Attributed to the
        // same slug PostHog already uses, so the prospect timeline merges:
        // memo_view -> email_opened -> short_link_clicked -> call_booked.
        if (!dryRun) {
          if (update.newOpens > 0) {
            for (let i = 0; i < update.newOpens; i += 1) {
              await captureServerEvent({
                event: 'email_opened',
                distinctId: prospect.slug,
                properties: {
                  source: 'instantly',
                  campaign_id: campaign.id,
                  campaign_name: campaign.name,
                  instantly_lead_id: lead.id,
                  email,
                },
                timestamp: lead.timestamp_last_open || undefined,
              });
              opensFired += 1;
            }
          }
          if (update.newClicks > 0) {
            for (let i = 0; i < update.newClicks; i += 1) {
              await captureServerEvent({
                event: 'email_clicked',
                distinctId: prospect.slug,
                properties: {
                  source: 'instantly',
                  campaign_id: campaign.id,
                  campaign_name: campaign.name,
                  instantly_lead_id: lead.id,
                  email,
                  note: 'click count includes Instantly URL pre-scanner; cross-reference PostHog short_link_clicked uniques for human-only',
                },
              });
              clicksFired += 1;
            }
          }
          if (update.newReplies > 0) {
            // Classify the reply before celebrating it. The first reply this
            // system ever captured was an "I have left the company" auto-
            // responder; an OOO bot must never reach the Raised-hand tier.
            const replyKind = await classifyLatestReply(apiKey, email);
            for (let i = 0; i < update.newReplies; i += 1) {
              await captureServerEvent({
                event: 'email_replied',
                // Identity spine = the prospect's email, same as bookings.
                distinctId: email,
                properties: {
                  source: 'instantly',
                  campaign_id: campaign.id,
                  campaign_name: campaign.name,
                  instantly_lead_id: lead.id,
                  email,
                  prospect_slug: prospect.slug,
                  reply_kind: replyKind,
                },
              });
              repliesFired += 1;
            }
          }
          // First-sync sent event: fire once when we discover the lead has
          // been contacted by Instantly but Airtable has no Instantly Lead ID
          // yet. Subsequent step sends don't fire their own event - sentAt
          // bumps to the most-recent send.
          if (update.firstSeenSent) {
            await captureServerEvent({
              event: 'email_sent',
              distinctId: prospect.slug,
              properties: {
                source: 'instantly',
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                instantly_lead_id: lead.id,
                email,
              },
              timestamp: lead.timestamp_last_contact || undefined,
            });
          }
        }
      }
      cursor = page.next;
    } while (cursor && scanned < MAX_LEADS_PER_CAMPAIGN);

    perCampaign.push({ id: campaign.id, name: campaign.name, leads: scanned, matched });
  }

  let recordsWritten = 0;
  if (!dryRun && updates.length > 0) {
    recordsWritten = await updateProspectEngagementBatch(updates);
  }

  return json({
    ok: true,
    dryRun,
    totalMs: Date.now() - started,
    campaigns: perCampaign,
    totalLeadsScanned: totalLeads,
    matchedToAirtable: matchedLeads,
    airtableUpdates: recordsWritten,
    posthogEvents: {
      opened: opensFired,
      clicked: clicksFired,
      replied: repliesFired,
    },
  });
};

// Manual operator trigger - POST with the same secret to force a sync.
export const POST: APIRoute = GET;

// --- helpers ---

async function listCampaigns(apiKey: string): Promise<InstantlyCampaign[]> {
  const campaigns: InstantlyCampaign[] = [];
  let cursor: string | undefined;
  do {
    const u = new URL(`${INSTANTLY_BASE}/campaigns`);
    u.searchParams.set('limit', '50');
    if (cursor) u.searchParams.set('starting_after', cursor);
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Instantly campaigns ${res.status}`);
    const data = (await res.json()) as {
      items?: InstantlyCampaign[];
      next_starting_after?: string;
    };
    for (const c of data.items ?? []) campaigns.push(c);
    cursor = data.next_starting_after;
  } while (cursor);
  return campaigns;
}

async function fetchLeadsPage(
  apiKey: string,
  campaignId: string,
  cursor: string | undefined
): Promise<{ items: InstantlyLead[]; next?: string } | null> {
  const body: Record<string, unknown> = {
    campaign: campaignId,
    limit: PAGE_SIZE,
  };
  if (cursor) body.starting_after = cursor;
  const res = await fetch(`${INSTANTLY_BASE}/leads/list`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.warn('[sync-instantly] leads/list failed', campaignId, res.status);
    return null;
  }
  const data = (await res.json()) as {
    items?: InstantlyLead[];
    next_starting_after?: string;
  };
  return { items: data.items ?? [], next: data.next_starting_after };
}

interface BuiltUpdate {
  update: ProspectEngagementUpdate | null;
  newOpens: number;
  newClicks: number;
  newReplies: number;
  firstSeenSent: boolean;
}

function buildUpdate(
  prospect: ProspectInfo,
  lead: InstantlyLead,
  _campaign: InstantlyCampaign
): BuiltUpdate {
  const instantlyOpens = lead.email_open_count ?? 0;
  const instantlyClicks = lead.email_click_count ?? 0;
  const instantlyReplies = lead.email_reply_count ?? 0;
  const lastContact = lead.timestamp_last_contact
    || lead.status_summary?.lastStep?.timestamp_executed
    || '';
  const lastOpen = lead.timestamp_last_open || '';
  const lastTouch = lead.timestamp_last_touch || '';

  const hasBeenSent = Boolean(lastContact);
  const hasReplied = instantlyReplies > 0;

  // Deltas. Clamp to >=0 (we never want to fire "negative" events; if Airtable
  // somehow had a higher count, leave the higher count as-is). The `|| 0`
  // coerces stale cached objects (which may lack the new engagement keys)
  // from undefined to 0 so the subtraction stays finite.
  const baseOpens = Number(prospect.opens) || 0;
  const baseClicks = Number(prospect.clicks) || 0;
  const baseReplies = Number(prospect.replies) || 0;
  const newOpens = Math.max(0, instantlyOpens - baseOpens);
  const newClicks = Math.max(0, instantlyClicks - baseClicks);
  const newReplies = Math.max(0, instantlyReplies - baseReplies);
  const firstSeenSent = hasBeenSent && !prospect.instantlyLeadId;

  // Build the "most recent engagement" timestamp across the three signals.
  const lastEngagedAt = pickLatest([lastOpen, lastTouch, lastContact]);
  // sent_at goes to the day of timestamp_last_contact (Airtable expects date,
  // not datetime). Same for replied_at - Instantly doesn't expose per-reply
  // timestamps, but timestamp_last_touch becomes the reply day when reply
  // count > 0 and last_touch > last_contact.
  const sentAt = hasBeenSent ? toIsoDate(lastContact) : '';
  const repliedAt = hasReplied && lastTouch ? toIsoDate(lastTouch) : '';

  // Skip the write if nothing changed - avoids an Airtable PATCH that would
  // bust the cache for no reason.
  const countsChanged =
    instantlyOpens !== prospect.opens ||
    instantlyClicks !== prospect.clicks ||
    instantlyReplies !== prospect.replies;
  const idChanged = !prospect.instantlyLeadId && Boolean(lead.id);
  const lastEngagedChanged = Boolean(lastEngagedAt) && lastEngagedAt !== prospect.lastEngagedAt;
  const sentAtChanged = Boolean(sentAt) && sentAt !== prospect.sentAt;
  const repliedAtChanged = Boolean(repliedAt) && repliedAt !== prospect.repliedAt;

  if (
    !countsChanged &&
    !idChanged &&
    !lastEngagedChanged &&
    !sentAtChanged &&
    !repliedAtChanged
  ) {
    return { update: null, newOpens, newClicks, newReplies, firstSeenSent };
  }

  const update: ProspectEngagementUpdate = {
    recordId: prospect.recordId,
    currentStage: prospect.outreachStage,
    hasBeenSent,
    hasReplied,
  };
  if (countsChanged) {
    update.opens = instantlyOpens;
    update.clicks = instantlyClicks;
    update.replies = instantlyReplies;
  }
  if (idChanged) update.instantlyLeadId = lead.id;
  if (lastEngagedChanged) update.lastEngagedAt = lastEngagedAt;
  if (sentAtChanged) update.sentAt = sentAt;
  if (repliedAtChanged) update.repliedAt = repliedAt;

  return { update, newOpens, newClicks, newReplies, firstSeenSent };
}

// Auto-reply fingerprints. Subject markers are the strongest signal (mail
// clients stamp them); body markers catch leavers and delivery bounces.
const AUTO_REPLY_RE =
  /automatic reply|auto-?reply|autoreply|out of (the )?office|i have (now )?left|no longer (with|at|work)|on (annual |parental |maternity |sick )?leave|delivery (status |has )?fail|undeliverable|mailer-daemon|do not reply/i;

/**
 * Fetch the most recent INCOMING email from this address and classify it.
 * Returns 'human' | 'auto' | 'unknown'. Fails open to 'unknown' (never
 * blocks the event) - the call list treats only confirmed 'auto' as noise.
 */
async function classifyLatestReply(apiKey: string, leadEmail: string): Promise<string> {
  try {
    const u = new URL(`${INSTANTLY_BASE}/emails`);
    u.searchParams.set('search', leadEmail);
    u.searchParams.set('limit', '10');
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as {
      items?: Array<{
        from_address_email?: string;
        subject?: string;
        timestamp_created?: string;
        body?: { text?: string } | string;
      }>;
    };
    const incoming = (data.items ?? [])
      .filter((e) => (e.from_address_email || '').toLowerCase() === leadEmail.toLowerCase())
      .sort((a, b) => Date.parse(b.timestamp_created || '') - Date.parse(a.timestamp_created || ''));
    const latest = incoming[0];
    if (!latest) return 'unknown';
    const bodyText =
      typeof latest.body === 'string' ? latest.body : latest.body?.text || '';
    const haystack = `${latest.subject || ''}\n${bodyText}`.slice(0, 2000);
    return AUTO_REPLY_RE.test(haystack) ? 'auto' : 'human';
  } catch {
    return 'unknown';
  }
}

function pickLatest(candidates: string[]): string {
  let best = '';
  let bestT = 0;
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t) && t > bestT) {
      bestT = t;
      best = c;
    }
  }
  return best;
}

function toIsoDate(iso: string): string {
  if (!iso) return '';
  // Airtable date field (without time) expects YYYY-MM-DD.
  return iso.slice(0, 10);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

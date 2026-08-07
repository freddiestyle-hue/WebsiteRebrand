// Notification layer for /hq. Two flavors:
//
//   sendDigestEmail()     - daily morning summary. Action queue, hot signals,
//                            numbers. Fired by the daily cron at 06:00 UTC.
//   sendHotAlertEmail()   - real-time ping when something high-intent happens.
//                            Fired by PostHog webhook -> /api/hq/notify.
//
// Both go through Resend (already in env: RESEND_API_KEY). Recipient is
// NOTIFICATION_EMAIL (Fred). Sender is qualify@rivett.tech by default — same
// from-address pattern the rest of the site already uses.

import { Resend } from 'resend';
import type { TopProspect } from '../posthog/query';

const FROM_EMAIL = process.env.QUALIFY_FROM_EMAIL || 'qualify@rivett.tech';

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function getRecipient(): string | null {
  return process.env.NOTIFICATION_EMAIL ?? null;
}

function dwellHuman(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function heatTag(p: TopProspect): string {
  // Keep aligned with ActionQueue.astro heatBadge.
  if (p.cta_clicks > 0) return 'CTA CLICK';
  if (p.prints > 0) return 'PRINTED';
  if (p.copies > 0) return 'COPIED';
  if (p.return_visitor) return 'RETURNED';
  if (p.verdict_expansions > 0) return 'VERDICTS';
  if (p.scroll_100s > 0) return 'FULL READ';
  if (p.total_dwell_seconds >= 120) return 'DEEP READ';
  if (p.total_dwell_seconds >= 30) return 'WARM';
  return 'ENGAGED';
}

// --------------------------------------------------------------------------
// Daily digest email
// --------------------------------------------------------------------------

export interface DigestInput {
  actionQueue: TopProspect[];          // unmessaged engaged prospects
  totalEngagedToday: number;            // count of engaged reads today
  ctaClicksToday: number;
  ctaClicks7d: number;
  memoViewsToday: number;
  memoViews7d: number;
  hqUrl: string;                        // e.g. 'https://rivett.tech/hq'
}

export async function sendDigestEmail(input: DigestInput): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  const to = getRecipient();
  if (!resend || !to) {
    return { ok: false, error: 'Resend or NOTIFICATION_EMAIL not configured' };
  }

  const topN = input.actionQueue.slice(0, 5);
  const qCount = input.actionQueue.length;

  // Subject reframed for Action Center cutover (2026-05-28). Lead with
  // the actionable count — that's the number Fred acts on. CTA click count
  // and engagement metrics live in the body, not the subject. Quiet-day
  // digests are now skipped entirely upstream, so this fallback rarely
  // fires.
  const subject = qCount > 0
    ? `Rivett Action Center · ${qCount} ${qCount === 1 ? 'prospect' : 'prospects'} waiting`
    : `Rivett Action Center · quiet day`;

  const text = buildDigestText(input, topN);
  const html = buildDigestHtml(input, topN);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
      tags: [{ name: 'kind', value: 'hq-digest' }],
    });
    if (error) return { ok: false, error: String(error.message ?? error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function buildDigestText(input: DigestInput, topN: TopProspect[]): string {
  const lines: string[] = [];
  lines.push('Rivett HQ daily digest');
  lines.push('');
  lines.push(`Action queue: ${input.actionQueue.length} prospect${input.actionQueue.length === 1 ? '' : 's'} waiting`);
  lines.push(`CTA clicks today: ${input.ctaClicksToday} (7d: ${input.ctaClicks7d})`);
  lines.push(`Memo views today: ${input.memoViewsToday} (7d: ${input.memoViews7d})`);
  lines.push('');

  if (topN.length > 0) {
    lines.push('TOP UNMESSAGED PROSPECTS:');
    topN.forEach((p, i) => {
      lines.push(`${String(i + 1).padStart(2, '0')}. ${heatTag(p)} · ${p.prospect}`);
      lines.push(`    ${dwellHuman(p.total_dwell_seconds)} dwell · ${p.unique_sessions} session(s) · ${p.total_views} view(s) · last ${timeAgo(p.last_view)}`);
    });
    lines.push('');
  } else {
    lines.push('No prospects in queue. Either everyone is messaged or no engagement signal yet.');
    lines.push('');
  }

  lines.push(`Open HQ: ${input.hqUrl}`);
  return lines.join('\n');
}

function buildDigestHtml(input: DigestInput, topN: TopProspect[]): string {
  const queueRows = topN
    .map((p) => {
      const heat = heatTag(p);
      const heatColor =
        heat === 'CTA CLICK' ? '#4A6E18'
        : heat === 'DEEP READ' ? '#4A6E18'
        : heat === 'WARM' ? '#A5E85C'
        : '#454745';
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid rgba(22,51,0,0.14);font-family:'DM Mono',monospace;font-size:11px;color:${heatColor};font-weight:600;letter-spacing:0.08em;white-space:nowrap;">${heat}</td>
          <td style="padding:10px 8px;border-bottom:1px solid rgba(22,51,0,0.14);">
            <div style="font-weight:600;color:#163300;">${p.prospect}</div>
            <div style="font-family:'DM Mono',monospace;font-size:12px;color:#6F7A64;margin-top:2px;">
              ${dwellHuman(p.total_dwell_seconds)} dwell · ${p.unique_sessions} session(s) · ${p.total_views} view(s)
            </div>
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid rgba(22,51,0,0.14);font-family:'DM Mono',monospace;font-size:12px;color:#6F7A64;text-align:right;white-space:nowrap;">${timeAgo(p.last_view)}</td>
        </tr>
      `;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Rivett HQ digest</title></head>
<body style="margin:0;padding:24px;background:#F2F5EC;font-family:-apple-system,BlinkMacSystemFont,'Inter Tight',sans-serif;color:#163300;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid rgba(22,51,0,0.14);border-radius:6px;overflow:hidden;">

  <div style="padding:18px 22px;background:#163300;color:#fff;">
    <div style="font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.7;">Rivett HQ · daily digest</div>
    <div style="margin-top:4px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">${input.actionQueue.length} prospect${input.actionQueue.length === 1 ? '' : 's'} waiting for follow-up</div>
  </div>

  <div style="padding:18px 22px;border-bottom:1px solid rgba(22,51,0,0.14);">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 0;font-family:'DM Mono',monospace;font-size:11px;color:#6F7A64;letter-spacing:0.08em;text-transform:uppercase;">CTA clicks today</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${input.ctaClicksToday} <span style="color:#6F7A64;font-weight:400;font-size:13px;">(${input.ctaClicks7d} this week)</span></td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-family:'DM Mono',monospace;font-size:11px;color:#6F7A64;letter-spacing:0.08em;text-transform:uppercase;">Memo views today</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${input.memoViewsToday} <span style="color:#6F7A64;font-weight:400;font-size:13px;">(${input.memoViews7d} this week)</span></td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-family:'DM Mono',monospace;font-size:11px;color:#6F7A64;letter-spacing:0.08em;text-transform:uppercase;">Engaged reads today</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${input.totalEngagedToday}</td>
      </tr>
    </table>
  </div>

  ${topN.length > 0 ? `
  <div style="padding:18px 22px;border-bottom:1px solid rgba(22,51,0,0.14);">
    <div style="font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6F7A64;margin-bottom:10px;">Top of the queue</div>
    <table style="width:100%;border-collapse:collapse;">${queueRows}</table>
  </div>
  ` : `
  <div style="padding:22px;font-family:'Newsreader',Georgia,serif;font-style:italic;color:#6F7A64;">
    Queue is empty. Either you're caught up or your outreach hasn't generated engagement signal yet today.
  </div>
  `}

  <div style="padding:18px 22px;text-align:center;">
    <a href="${input.hqUrl}" style="display:inline-block;padding:10px 22px;background:#163300;color:#fff;text-decoration:none;border-radius:4px;font-family:'DM Mono',monospace;font-size:13px;font-weight:500;">Open HQ →</a>
  </div>

  <div style="padding:14px 22px;background:#F2F5EC;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6F7A64;text-align:center;">
    rivett · sent ${new Date().toISOString().slice(0, 10)}
  </div>

</div>
</body></html>`;
}

// --------------------------------------------------------------------------
// Real-time hot alert email
// --------------------------------------------------------------------------

export interface HotAlertInput {
  prospect: string;
  signal: string;            // e.g. "CTA click on Book a call"
  detail?: string;           // optional sub-line
  replayUrl?: string | null;
  memoUrl: string;
  hqUrl: string;
  whenIso: string;
  city?: string | null;
  country?: string | null;
}

export async function sendHotAlertEmail(input: HotAlertInput): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend();
  const to = getRecipient();
  if (!resend || !to) {
    return { ok: false, error: 'Resend or NOTIFICATION_EMAIL not configured' };
  }

  const subject = `HOT · ${input.prospect} · ${input.signal}`;
  const geo = [input.city, input.country].filter(Boolean).join(', ');

  const text = [
    `${input.signal}`,
    '',
    `Prospect: ${input.prospect}`,
    geo ? `Location: ${geo}` : '',
    `When: ${new Date(input.whenIso).toUTCString()}`,
    input.detail ? `Detail: ${input.detail}` : '',
    '',
    input.replayUrl ? `Watch replay: ${input.replayUrl}` : '',
    `Open memo: ${input.memoUrl}`,
    `Open HQ: ${input.hqUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#F2F5EC;font-family:-apple-system,BlinkMacSystemFont,'Inter Tight',sans-serif;color:#163300;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:2px solid #4A6E18;border-radius:6px;overflow:hidden;">
  <div style="padding:16px 22px;background:#4A6E18;color:#fff;">
    <div style="font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.85;">Rivett HQ · hot signal</div>
    <div style="margin-top:4px;font-size:20px;font-weight:600;letter-spacing:-0.02em;">${input.signal}</div>
  </div>
  <div style="padding:20px 22px;">
    <div style="font-size:22px;font-weight:700;color:#163300;letter-spacing:-0.02em;">${input.prospect}</div>
    ${geo ? `<div style="font-family:'DM Mono',monospace;font-size:12px;color:#6F7A64;margin-top:4px;letter-spacing:0.05em;">${geo} · ${new Date(input.whenIso).toUTCString()}</div>` : ''}
    ${input.detail ? `<p style="margin:12px 0 0;color:#454745;line-height:1.5;">${input.detail}</p>` : ''}
  </div>
  <div style="padding:0 22px 20px;display:flex;gap:8px;flex-wrap:wrap;">
    ${input.replayUrl ? `<a href="${input.replayUrl}" style="display:inline-block;padding:9px 16px;background:#163300;color:#fff;text-decoration:none;border-radius:4px;font-family:'DM Mono',monospace;font-size:12px;font-weight:500;">Watch replay →</a>` : ''}
    <a href="${input.memoUrl}" style="display:inline-block;padding:9px 16px;background:#fff;color:#163300;border:1px solid rgba(22,51,0,0.28);text-decoration:none;border-radius:4px;font-family:'DM Mono',monospace;font-size:12px;font-weight:500;">Open memo</a>
    <a href="${input.hqUrl}" style="display:inline-block;padding:9px 16px;background:#fff;color:#163300;border:1px solid rgba(22,51,0,0.28);text-decoration:none;border-radius:4px;font-family:'DM Mono',monospace;font-size:12px;font-weight:500;">Open HQ</a>
  </div>
  <div style="padding:14px 22px;background:#F2F5EC;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#6F7A64;text-align:center;">
    rivett · act fast — engagement decays
  </div>
</div>
</body></html>`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
      tags: [{ name: 'kind', value: 'hq-hot-alert' }],
    });
    if (error) return { ok: false, error: String(error.message ?? error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

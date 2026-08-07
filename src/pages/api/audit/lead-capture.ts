// Lead capture endpoint for the /audit/run soft gate.
//
// Flow: visitor runs a public audit preview, sees a gated/redacted section,
// and submits contact details. We send Fred a real-time notification email
// with the visitor's email + the audited domain + audit ID/context. No list,
// no Airtable, no Resend audience — Fred's explicit choice. If he later wants
// persistence, add it then.
//
// Pattern mirrors src/pages/api/mri-lead.ts (Resend + QUALIFY_FROM_EMAIL
// + NOTIFICATION_EMAIL env vars + honeypot field + isEmail validation).
//
// Body shape:
//   {
//     email: string,
//     name?: string,
//     context?: string,
//     audited_url: string,       // the URL they ran the audit on
//     audit_id?: string,         // optional audit identifier
//     score_percent?: number,    // optional audit score
//     audit_run_url?: string,    // the /audit/run?url=... they're on
//     website?: string,          // honeypot — bots fill this, humans don't
//   }

import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { captureServerEvent } from '../../../utils/posthog/capture';

export const prerender = false;

type LeadPayload = {
  email?: string;
  name?: string;
  context?: string;
  audited_url?: string;
  audit_id?: string;
  score_percent?: number;
  audit_run_url?: string;
  website?: string;
};

export const POST: APIRoute = async ({ request }) => {
  let payload: LeadPayload;

  try {
    payload = (await request.json()) as LeadPayload;
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  // Honeypot: bots fill the hidden `website` field, humans don't see it.
  // Return 200-ok so the bot thinks it succeeded and stops retrying.
  if (payload.website && payload.website.trim().length > 0) {
    return json({ ok: true });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const context = typeof payload.context === 'string' ? payload.context.trim().slice(0, 2000) : '';
  const auditedUrl = typeof payload.audited_url === 'string' ? payload.audited_url.trim() : '';
  const auditId = typeof payload.audit_id === 'string' ? payload.audit_id.trim() : '';
  const scorePercent = Number.isFinite(payload.score_percent as number) ? Number(payload.score_percent) : null;
  const auditRunUrl = typeof payload.audit_run_url === 'string' ? payload.audit_run_url.trim() : '';

  if (!isEmail(email)) {
    return json({ error: 'Use a valid email.' }, 400);
  }
  if (!auditedUrl) {
    return json({ error: 'Missing audited_url.' }, 400);
  }

  const submittedAt = new Date().toISOString();
  const eventProps = {
    source: 'audit_v3_preview_gate',
    audited_url: auditedUrl,
    audit_id: auditId || null,
    score_percent: scorePercent,
    score_band: scoreBand(scorePercent),
    audit_run_url: auditRunUrl || null,
    has_context: context.length > 0,
  };
  await captureServerEvent({
    event: 'audit_lead_received',
    distinctId: email,
    properties: eventProps,
    timestamp: submittedAt,
  });

  const resendApiKey = process.env.RESEND_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  const fromEmail = process.env.QUALIFY_FROM_EMAIL || 'qualify@rivett.tech';

  if (!resendApiKey || !notificationEmail) {
    // Don't return a hard error — visitor shouldn't get blocked because
    // of misconfigured backend. Log + return ok so the client-side unlock
    // still fires. Fred sees nothing, but the lead isn't lost from the
    // visitor's perspective (they got value).
    console.error('[audit/lead-capture] RESEND_API_KEY or NOTIFICATION_EMAIL not set; lead silently dropped:', { email, auditedUrl });
    await captureServerEvent({
      event: 'audit_lead_email_failed',
      distinctId: email,
      properties: { ...eventProps, reason: 'backend_not_configured' },
      timestamp: submittedAt,
    });
    return json({ ok: true, unlock: true, note: 'backend_not_configured' });
  }

  const resend = new Resend(resendApiKey);
  const subject = `Audit lead · ${auditedUrl}`;

  const html = buildHtmlEmail({
    email,
    name,
    context,
    auditedUrl,
    auditId,
    scorePercent,
    auditRunUrl,
    submittedAt,
  });
  const text = buildTextEmail({
    email,
    name,
    context,
    auditedUrl,
    auditId,
    scorePercent,
    auditRunUrl,
    submittedAt,
  });

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: notificationEmail,
    subject,
    html,
    text,
    replyTo: email,
    tags: [{ name: 'source', value: 'audit-gate' }],
  });

  if (error) {
    console.error('[audit/lead-capture] resend error', error);
    // Don't punish the visitor — return ok so the unlock fires anyway.
    // Fred can find them by reply-to if Resend dashboard logs the send.
    await captureServerEvent({
      event: 'audit_lead_email_failed',
      distinctId: email,
      properties: { ...eventProps, reason: 'resend_error' },
      timestamp: submittedAt,
    });
    return json({ ok: true, unlock: true, note: 'send_failed' });
  }

  await captureServerEvent({
    event: 'audit_lead_email_sent',
    distinctId: email,
    properties: eventProps,
    timestamp: submittedAt,
  });

  return json({ ok: true, unlock: true });
};

// --- Helpers ---

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function scoreBand(score: number | null) {
  if (score == null) return 'unknown';
  if (score >= 80) return '80_100';
  if (score >= 60) return '60_79';
  if (score >= 40) return '40_59';
  return '0_39';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailContext {
  email: string;
  name: string;
  context: string;
  auditedUrl: string;
  auditId: string;
  scorePercent: number | null;
  auditRunUrl: string;
  submittedAt: string;
}

function buildHtmlEmail(c: EmailContext) {
  const scoreLine = c.scorePercent != null
    ? `<strong>Score:</strong> ${c.scorePercent}%<br />`
    : '';
  const auditIdLine = c.auditId ? `<strong>Audit ID:</strong> ${escapeHtml(c.auditId)}<br />` : '';
  const nameLine = c.name ? `<strong>Name:</strong> ${escapeHtml(c.name)}<br />` : '';
  const contextBlock = c.context
    ? `<div style="margin:18px 0 0;padding:14px 16px;background:#F2F5EC;border-left:3px solid #A5E85C;font-family:'Inter Tight',Inter,Arial,sans-serif;font-size:14px;line-height:1.55;color:#454745;"><strong style="color:#163300;">Context:</strong><br />${escapeHtml(c.context).replace(/\n/g, '<br />')}</div>`
    : '';
  const linkLine = c.auditRunUrl
    ? `<a href="${escapeHtml(c.auditRunUrl)}" style="color:#4A6E18;text-decoration:underline;">Open the audit they saw →</a>`
    : '';

  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#F2F5EC;color:#163300;">
        <main style="max-width:560px;margin:0 auto;padding:32px 24px;background:#FFFFFF;border:1px solid rgba(22,51,0,0.14);">
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#4A6E18;margin-bottom:14px;">
            Rivett audit · new lead
          </div>
          <h1 style="font-family:'Inter Tight',Inter,Arial,sans-serif;font-size:24px;line-height:1.2;margin:0 0 8px;color:#163300;letter-spacing:-0.02em;">
            ${escapeHtml(c.auditedUrl)}
          </h1>
          <p style="font-family:'Inter Tight',Inter,Arial,sans-serif;font-size:15px;line-height:1.6;margin:0 0 24px;color:#454745;">
            <strong>Email:</strong> <a href="mailto:${escapeHtml(c.email)}" style="color:#4A6E18;">${escapeHtml(c.email)}</a><br />
            ${nameLine}
            ${scoreLine}
            ${auditIdLine}
            <strong>Submitted:</strong> ${escapeHtml(c.submittedAt)}
          </p>
          ${contextBlock}
          ${linkLine ? `<div style="padding:14px 0;border-top:1px solid rgba(22,51,0,0.14);font-family:'DM Mono',ui-monospace,monospace;font-size:13px;">${linkLine}</div>` : ''}
          <p style="margin-top:24px;font-family:'Newsreader',Georgia,serif;font-style:italic;font-size:14px;color:#6F7A64;">
            They submitted the audit gate form. Reply directly to start the conversation.
          </p>
        </main>
      </body>
    </html>
  `;
}

function buildTextEmail(c: EmailContext) {
  return [
    'Rivett audit · new lead',
    '',
    `Email: ${c.email}`,
    c.name ? `Name: ${c.name}` : '',
    `Audited URL: ${c.auditedUrl}`,
    c.scorePercent != null ? `Score: ${c.scorePercent}%` : '',
    c.auditId ? `Audit ID: ${c.auditId}` : '',
    `Submitted: ${c.submittedAt}`,
    c.context ? `Context:\n${c.context}` : '',
    '',
    c.auditRunUrl ? `Audit they saw: ${c.auditRunUrl}` : '',
    '',
    'They submitted the audit gate form. Reply directly to start the conversation.',
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

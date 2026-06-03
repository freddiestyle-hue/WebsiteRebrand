import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { captureServerEvent } from '../../utils/posthog/capture';

export const prerender = false;

type IntakePayload = {
  name?: string;
  email?: string;
  notes?: string;
  path?: string;
  submitted_at?: string;
  // honeypot — bots fill this, humans never see it
  website?: string;
};

type IntakeMessage = {
  name: string;
  email: string;
  notes: string;
  path: string;
  submittedAt: string;
};

export const POST: APIRoute = async ({ request }) => {
  let payload: IntakePayload;

  try {
    payload = (await request.json()) as IntakePayload;
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  // Honeypot — silent success so bots don't probe further.
  if (payload.website) {
    return json({ ok: true });
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const notes = typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 4000) : '';
  const path = typeof payload.path === 'string' ? payload.path.trim() : '/diagnostic';
  const submittedAt = typeof payload.submitted_at === 'string' ? payload.submitted_at : new Date().toISOString();

  if (!name) {
    return json({ error: 'Name required.' }, 400);
  }
  if (!isEmail(email)) {
    return json({ error: 'Use a valid email.' }, 400);
  }

  const message: IntakeMessage = { name, email, notes, path, submittedAt };

  const eventProps = {
    source: 'diagnostic_intake',
    path,
    has_notes: Boolean(notes),
    notes_length: notes.length,
    name_length: name.length,
    submitted_at: submittedAt,
  };

  // Always capture the lead server-side, even if email fails. This is the
  // proof-of-intent record - browser-side captures can be lost to ad blockers
  // and SafeLinks bots; this one is authoritative.
  await captureServerEvent({
    event: 'diagnostic_intake_received',
    distinctId: email,
    properties: eventProps,
    timestamp: submittedAt,
  });

  const resendApiKey = process.env.RESEND_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  const fromEmail = process.env.QUALIFY_FROM_EMAIL || 'qualify@rivett.tech';

  if (!resendApiKey || !notificationEmail) {
    // Lead is captured; email pipeline misconfigured. Return ok so the Cal
    // modal still opens client-side - Fred can re-trace via PostHog.
    await captureServerEvent({
      event: 'diagnostic_intake_email_failed',
      distinctId: email,
      properties: { ...eventProps, reason: 'backend_not_configured' },
      timestamp: submittedAt,
    });
    return json({ ok: true, warning: 'email_not_configured' });
  }

  const resend = new Resend(resendApiKey);
  const subject = `Diagnostic intake: ${name}`;
  const html = buildHtmlEmail(message);
  const text = buildTextEmail(message);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: notificationEmail,
    subject,
    html,
    text,
    replyTo: email,
    tags: [{ name: 'source', value: 'diagnostic-intake' }],
  });

  if (error) {
    await captureServerEvent({
      event: 'diagnostic_intake_email_failed',
      distinctId: email,
      properties: { ...eventProps, reason: 'resend_error' },
      timestamp: submittedAt,
    });
    // Don't 502 - lead is captured, Cal modal is the conversion path. Log + return ok.
    return json({ ok: true, warning: 'email_failed' });
  }

  await captureServerEvent({
    event: 'diagnostic_intake_email_sent',
    distinctId: email,
    properties: eventProps,
    timestamp: submittedAt,
  });

  return json({ ok: true });
};

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtmlEmail(payload: IntakeMessage) {
  const notesBlock = payload.notes
    ? `<section style="margin-top:28px;padding-top:24px;border-top:1px solid rgba(14,26,44,0.14);">
         <h2 style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;text-transform:uppercase;letter-spacing:0.18em;color:#4A6E18;margin:0 0 12px;">Where are the numbers</h2>
         <p style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.65;color:#0E1A2C;white-space:pre-wrap;margin:0;">${escapeHtml(payload.notes)}</p>
       </section>`
    : `<section style="margin-top:28px;padding-top:24px;border-top:1px solid rgba(14,26,44,0.14);">
         <p style="font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.5;color:#7A8597;font-style:italic;margin:0;">No intake notes provided. Ask in the reply.</p>
       </section>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F4F2ED;color:#0E1A2C;">
    <main style="max-width:720px;margin:0 auto;padding:40px 24px;background:#FFFFFF;">
      <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;text-transform:uppercase;letter-spacing:0.18em;color:#4A6E18;margin-bottom:16px;">
        Rivett diagnostic intake
      </div>
      <h1 style="font-family:'Inter Tight',Inter,Arial,sans-serif;font-size:30px;line-height:1.15;margin:0 0 12px;color:#0E1A2C;">
        ${escapeHtml(payload.name)}
      </h1>
      <p style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;margin:0;color:#3A4658;">
        <strong>Email:</strong> <a href="mailto:${escapeHtml(payload.email)}" style="color:#4A6E18;">${escapeHtml(payload.email)}</a><br />
        <strong>Path:</strong> ${escapeHtml(payload.path)}<br />
        <strong>Submitted:</strong> ${escapeHtml(payload.submittedAt)}
      </p>
      ${notesBlock}
      <p style="margin-top:32px;font-family:'DM Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#7A8597;">
        Reply within 24 hours. Cal modal opened on submit — they may have already booked a slot.
      </p>
    </main>
  </body>
</html>`;
}

function buildTextEmail(payload: IntakeMessage) {
  const lines = [
    'Rivett diagnostic intake',
    '',
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Path: ${payload.path}`,
    `Submitted: ${payload.submittedAt}`,
    '',
  ];
  if (payload.notes) {
    lines.push('Where are the numbers:');
    lines.push(payload.notes);
  } else {
    lines.push('No intake notes provided.');
  }
  lines.push('');
  lines.push('Reply within 24 hours. Cal modal opened on submit - they may have already booked.');
  return lines.join('\n');
}

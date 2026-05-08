import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const prerender = false;

type SubscribePayload = {
  email?: string;
  name?: string;
  source?: string;
  path?: string;
  website?: string;
};

type SubscribeMessage = {
  email: string;
  name: string;
  source: string;
  path: string;
};

export const POST: APIRoute = async ({ request }) => {
  let payload: SubscribePayload;

  try {
    payload = (await request.json()) as SubscribePayload;
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  if (payload.website) {
    return json({ ok: true });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const source = typeof payload.source === 'string' ? payload.source.trim() : 'unknown';
  const path = typeof payload.path === 'string' ? payload.path.trim() : '';

  if (!isEmail(email)) {
    return json({ error: 'Use a valid email.' }, 400);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  const fromEmail = process.env.QUALIFY_FROM_EMAIL || 'qualify@rivett.tech';

  if (!resendApiKey || !notificationEmail) {
    return json({ error: 'Email is not configured yet.' }, 500);
  }

  const resend = new Resend(resendApiKey);
  const subject = `Field Notes subscribe: ${email}`;
  const message = { email, name, source, path };
  const html = buildHtmlEmail(message);
  const text = buildTextEmail(message);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: notificationEmail,
    subject,
    html,
    text,
    replyTo: email,
    tags: [{ name: 'source', value: 'field-notes' }],
  });

  if (error) {
    return json({ error: 'Email failed to send. Try again.' }, 502);
  }

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

function buildHtmlEmail(payload: SubscribeMessage) {
  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#F4F2ED;color:#0E1A2C;">
        <main style="max-width:640px;margin:0 auto;padding:40px 24px;background:#FFFFFF;">
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;text-transform:uppercase;color:#4A6E18;margin-bottom:16px;">
            Rivett Field Notes subscription
          </div>
          <h1 style="font-family:'Inter Tight',Inter,Arial,sans-serif;font-size:32px;line-height:1.12;margin:0 0 18px;color:#0E1A2C;">
            ${escapeHtml(payload.email)}
          </h1>
          <div style="font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.7;color:#3A4658;">
            <p><strong>Name:</strong> ${escapeHtml(payload.name || 'Not provided')}</p>
            <p><strong>Source:</strong> ${escapeHtml(payload.source)}</p>
            <p><strong>Path:</strong> ${escapeHtml(payload.path || 'Not provided')}</p>
          </div>
        </main>
      </body>
    </html>
  `;
}

function buildTextEmail(payload: SubscribeMessage) {
  return [
    'Rivett Field Notes subscription',
    `Email: ${payload.email}`,
    `Name: ${payload.name || 'Not provided'}`,
    `Source: ${payload.source}`,
    `Path: ${payload.path || 'Not provided'}`,
  ].join('\n');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

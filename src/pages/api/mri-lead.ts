import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { captureServerEvent } from '../../utils/posthog/capture';

export const prerender = false;

type MriLeadPayload = {
  email?: string;
  company?: string;
  source?: string;
  path?: string;
  submitted_at?: string;
  website?: string;
  inputs?: Record<string, unknown>;
  readout?: Record<string, unknown>;
};

type MriLeadMessage = {
  email: string;
  company: string;
  source: string;
  path: string;
  submittedAt: string;
  inputs: Record<string, number>;
  readout: Record<string, number>;
};

const inputKeys = ['spend', 'leads', 'deal', 'vendor', 'responseHrs', 'leadToOpp', 'oppClose', 'growthHrs', 'hourly'];
const readoutKeys = [
  'leakResponse',
  'leakConversion',
  'leakHandoff',
  'leakDrag',
  'total',
  'score',
  'annualised',
  'fLeads',
  'fContacted',
  'fOpps',
  'fClosed',
];

export const POST: APIRoute = async ({ request }) => {
  let payload: MriLeadPayload;

  try {
    payload = (await request.json()) as MriLeadPayload;
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  if (payload.website) {
    return json({ ok: true });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const company = typeof payload.company === 'string' ? payload.company.trim() : '';
  const source = typeof payload.source === 'string' ? payload.source.trim() : 'revenue-leak-mri';
  const path = typeof payload.path === 'string' ? payload.path.trim() : '/revenue-leak-mri';
  const submittedAt = typeof payload.submitted_at === 'string' ? payload.submitted_at : new Date().toISOString();

  if (!isEmail(email)) {
    return json({ error: 'Use a valid email.' }, 400);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  const fromEmail = process.env.QUALIFY_FROM_EMAIL || 'qualify@rivett.tech';

  const message: MriLeadMessage = {
    email,
    company,
    source,
    path,
    submittedAt,
    inputs: pickNumbers(payload.inputs, inputKeys),
    readout: pickNumbers(payload.readout, readoutKeys),
  };

  const eventProps = leadEventProps(message);
  await captureServerEvent({
    event: 'mri_lead_received',
    distinctId: email,
    properties: eventProps,
    timestamp: submittedAt,
  });

  if (!resendApiKey || !notificationEmail) {
    await captureServerEvent({
      event: 'mri_lead_email_failed',
      distinctId: email,
      properties: { ...eventProps, reason: 'backend_not_configured' },
      timestamp: submittedAt,
    });
    return json({ error: 'Email is not configured yet.' }, 500);
  }

  const resend = new Resend(resendApiKey);
  const subject = `Revenue MRI lead: ${company || email}`;
  const html = buildHtmlEmail(message);
  const text = buildTextEmail(message);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: notificationEmail,
    subject,
    html,
    text,
    replyTo: email,
    tags: [{ name: 'source', value: 'revenue-mri' }],
  });

  if (error) {
    await captureServerEvent({
      event: 'mri_lead_email_failed',
      distinctId: email,
      properties: { ...eventProps, reason: 'resend_error' },
      timestamp: submittedAt,
    });
    return json({ error: 'Email failed to send. Try again.' }, 502);
  }

  await captureServerEvent({
    event: 'mri_lead_email_sent',
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

function pickNumbers(value: unknown, keys: string[]) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

  return keys.reduce<Record<string, number>>((picked, key) => {
    const number = Number(source[key]);
    if (Number.isFinite(number)) picked[key] = number;
    return picked;
  }, {});
}

function leadEventProps(message: MriLeadMessage): Record<string, unknown> {
  const readout = message.readout;
  return {
    source: message.source,
    path: message.path,
    company: message.company || null,
    submitted_at: message.submittedAt,
    score_band: scoreBand(readout.score),
    total_leak_band: moneyBand(readout.total),
    annualised_band: moneyBand(readout.annualised),
    biggest_leak: biggestLeak(readout),
  };
}

function moneyBand(value: unknown) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return '1m_plus';
  if (n >= 500_000) return '500k_1m';
  if (n >= 100_000) return '100k_500k';
  if (n >= 50_000) return '50k_100k';
  if (n >= 10_000) return '10k_50k';
  if (n > 0) return '1_10k';
  return '0';
}

function scoreBand(value: unknown) {
  const n = Number(value) || 0;
  if (n >= 80) return '80_100';
  if (n >= 60) return '60_79';
  if (n >= 40) return '40_59';
  return '0_39';
}

function biggestLeak(readout: Record<string, number>) {
  return [
    ['response_decay', readout.leakResponse],
    ['conversion_gap', readout.leakConversion],
    ['sales_handoff', readout.leakHandoff],
    ['operating_drag', readout.leakDrag],
  ].sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]?.[0] ?? 'unknown';
}

function buildHtmlEmail(payload: MriLeadMessage) {
  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#F4F2ED;color:#0E1A2C;">
        <main style="max-width:720px;margin:0 auto;padding:40px 24px;background:#FFFFFF;">
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;text-transform:uppercase;color:#4A6E18;margin-bottom:16px;">
            Rivett Revenue MRI lead
          </div>
          <h1 style="font-family:'Inter Tight',Inter,Arial,sans-serif;font-size:32px;line-height:1.12;margin:0 0 12px;color:#0E1A2C;">
            ${escapeHtml(payload.company || payload.email)}
          </h1>
          <p style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;margin:0;color:#3A4658;">
            <strong>Email:</strong> ${escapeHtml(payload.email)}<br />
            <strong>Company:</strong> ${escapeHtml(payload.company || 'Not provided')}<br />
            <strong>Source:</strong> ${escapeHtml(payload.source)}<br />
            <strong>Path:</strong> ${escapeHtml(payload.path)}<br />
            <strong>Submitted:</strong> ${escapeHtml(payload.submittedAt)}
          </p>
          <section style="margin-top:28px;padding-top:24px;border-top:1px solid rgba(14,26,44,0.14);">
            <h2 style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;text-transform:uppercase;letter-spacing:0.18em;color:#4A6E18;margin:0 0 16px;">
              Readout
            </h2>
            ${renderRows(payload.readout, true)}
          </section>
          <section style="margin-top:28px;padding-top:24px;border-top:1px solid rgba(14,26,44,0.14);">
            <h2 style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;text-transform:uppercase;letter-spacing:0.18em;color:#4A6E18;margin:0 0 16px;">
              Inputs
            </h2>
            ${renderRows(payload.inputs)}
          </section>
        </main>
      </body>
    </html>
  `;
}

function buildTextEmail(payload: MriLeadMessage) {
  return [
    'Rivett Revenue MRI lead',
    `Email: ${payload.email}`,
    `Company: ${payload.company || 'Not provided'}`,
    `Source: ${payload.source}`,
    `Path: ${payload.path}`,
    `Submitted: ${payload.submittedAt}`,
    '',
    'Readout',
    renderTextRows(payload.readout, true),
    '',
    'Inputs',
    renderTextRows(payload.inputs),
  ].join('\n');
}

function renderRows(values: Record<string, number>, money = false) {
  return Object.entries(values).map(([key, value]) => `
    <div style="display:flex;justify-content:space-between;gap:24px;padding:10px 0;border-bottom:1px solid rgba(14,26,44,0.08);font-family:Inter,Arial,sans-serif;font-size:15px;color:#0E1A2C;">
      <span style="color:#3A4658;">${escapeHtml(formatKey(key))}</span>
      <strong>${escapeHtml(formatValue(key, value, money))}</strong>
    </div>
  `).join('');
}

function renderTextRows(values: Record<string, number>, money = false) {
  return Object.entries(values)
    .map(([key, value]) => `${formatKey(key)}: ${formatValue(key, value, money)}`)
    .join('\n');
}

function formatKey(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

function formatValue(key: string, value: number, money: boolean) {
  if (money && !['score', 'fLeads', 'fContacted', 'fOpps', 'fClosed'].includes(key)) {
    return `$${Math.round(value).toLocaleString()}`;
  }

  if (key === 'score') return `${Math.round(value)} / 100`;
  if (key === 'responseHrs') return `${value} hr`;
  if (key === 'leadToOpp' || key === 'oppClose') return `${value}%`;

  return Math.round(value).toLocaleString();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

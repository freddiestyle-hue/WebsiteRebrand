import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { getQuestionnaireConfig } from '../../questionnaires/_configs';
import type {
  AnswerValue,
  ProspectConfig,
  QuestionConfig,
  QuestionnaireAnswers,
} from '../../questionnaires/_types';

export const prerender = false;

type SubmissionPayload = {
  slug?: string;
  answers?: QuestionnaireAnswers;
  submitted_at?: string;
};

export const POST: APIRoute = async ({ request }) => {
  let payload: SubmissionPayload;

  try {
    payload = (await request.json()) as SubmissionPayload;
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const slug = typeof payload.slug === 'string' ? payload.slug : '';
  const config = getQuestionnaireConfig(slug);

  if (!config) {
    return json({ error: 'Unknown questionnaire.' }, 404);
  }

  const answers = isAnswerObject(payload.answers) ? payload.answers : {};
  const resendApiKey = process.env.RESEND_API_KEY;
  const notificationEmail = process.env[config.email_to];
  const fromEmail = process.env.QUALIFY_FROM_EMAIL || 'qualify@rivett.tech';

  if (!resendApiKey || !notificationEmail) {
    return json({ error: 'Email is not configured yet.' }, 500);
  }

  const answeredCount = countAnswered(config, answers);
  const subject = buildSubject(config, answers, answeredCount);
  const html = buildHtmlEmail(config, answers, answeredCount, payload.submitted_at);
  const text = buildTextEmail(config, answers, answeredCount, payload.submitted_at);
  const resend = new Resend(resendApiKey);

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: notificationEmail,
    subject,
    html,
    text,
    tags: [{ name: 'prospect', value: config.slug }],
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

function isAnswerObject(value: unknown): value is QuestionnaireAnswers {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildSubject(config: ProspectConfig, answers: QuestionnaireAnswers, answeredCount: number) {
  if (config.slug === 'qualify') {
    const companyUrl = formatAnswerValue(answers.company_url) || 'No company URL';
    const nameRole = answers.name_role;
    const name = typeof nameRole === 'object' && nameRole ? nameRole.name : '';
    return `New qualification: ${companyUrl} - ${name || 'No name'}`;
  }

  return `${config.prospect_name} pre-call: ${answeredCount} of ${config.questions.length} answered`;
}

function buildHtmlEmail(
  config: ProspectConfig,
  answers: QuestionnaireAnswers,
  answeredCount: number,
  submittedAt?: string
) {
  const rows = config.questions.map((question, index) => {
    const answer = renderAnswerHtml(question, answers[question.id]);

    return `
      <section style="padding:24px 0;border-bottom:1px solid rgba(14,26,44,0.14);">
        <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;line-height:1.5;text-transform:uppercase;color:#4A6E18;margin-bottom:12px;">
          ${index + 1} &rarr; ${escapeHtml(question.text)}
        </div>
        <div style="font-family:Inter,Arial,sans-serif;font-size:17px;line-height:1.6;color:#0E1A2C;white-space:pre-wrap;">
          ${answer || '<span style="color:#7A8597;font-style:italic;">Skipped</span>'}
        </div>
      </section>
    `;
  }).join('');

  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#F4F2ED;color:#0E1A2C;">
        <main style="max-width:720px;margin:0 auto;padding:40px 24px;background:#FFFFFF;">
          <div style="font-family:'DM Mono',ui-monospace,monospace;font-size:12px;text-transform:uppercase;color:#4A6E18;margin-bottom:16px;">
            Rivett questionnaire · ${escapeHtml(config.slug)}
          </div>
          <h1 style="font-family:'Inter Tight',Inter,Arial,sans-serif;font-size:32px;line-height:1.12;margin:0 0 12px;color:#0E1A2C;">
            ${escapeHtml(config.prospect_name)}
          </h1>
          <p style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;margin:0;color:#3A4658;">
            ${answeredCount} of ${config.questions.length} answered${submittedAt ? ` · Submitted ${escapeHtml(submittedAt)}` : ''}
          </p>
          <div style="margin-top:20px;">
            ${rows}
          </div>
        </main>
      </body>
    </html>
  `;
}

function buildTextEmail(
  config: ProspectConfig,
  answers: QuestionnaireAnswers,
  answeredCount: number,
  submittedAt?: string
) {
  const rows = config.questions.map((question, index) => {
    const answer = formatAnswer(question, answers[question.id]) || 'Skipped';
    return `${index + 1} -> ${question.text}\n${answer}`;
  });

  return [
    `Rivett questionnaire: ${config.slug}`,
    `${config.prospect_name}`,
    `${answeredCount} of ${config.questions.length} answered`,
    submittedAt ? `Submitted: ${submittedAt}` : '',
    '',
    rows.join('\n\n---\n\n'),
  ].filter(Boolean).join('\n');
}

function renderAnswerHtml(question: QuestionConfig, value: AnswerValue | undefined) {
  const answer = formatAnswer(question, value);
  return escapeHtml(answer).replace(/\n/g, '<br />');
}

function formatAnswer(question: QuestionConfig, value: AnswerValue | undefined) {
  if (Array.isArray(value)) {
    return value
      .map((selectedKey) => {
        const option = question.options?.find((candidate) => candidate.key === selectedKey);
        return option ? `${option.key}: ${option.label}` : selectedKey;
      })
      .join('\n');
  }

  if (typeof value === 'string') {
    if (question.type === 'single_select_letter') {
      const option = question.options?.find((candidate) => candidate.key === value);
      return option ? `${option.key}: ${option.label}` : value;
    }

    return value.trim();
  }

  if (value && typeof value === 'object') {
    const fields = question.fields ?? [];
    return fields
      .map((field) => {
        const fieldValue = value[field.id]?.trim();
        return fieldValue ? `${field.label}: ${fieldValue}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function formatAnswerValue(value: AnswerValue | undefined) {
  if (typeof value === 'string') return value.trim();
  return '';
}

function countAnswered(config: ProspectConfig, answers: QuestionnaireAnswers) {
  return config.questions.filter((question) => Boolean(formatAnswer(question, answers[question.id]))).length;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

import type { ProspectConfig } from './_types';

export const herculesConfig: ProspectConfig = {
  slug: 'hercules',
  prospect_name: 'Hercules',
  top_meta: 'Diagnostic intake · pre-call',
  welcome: {
    headline: 'For Robert, Scott, and Hercules',
    body: "Rivett helps operators find and fix the revenue leaks between marketing, sales, quoting, follow-up, and reporting.\n\nThis is not meant to replace discovery. It is a two-minute signal check so I can spend the call on the right problem.\n\nPick the closest answer on the first screen. After that, choose any answers that apply. If Robert and Scott see it differently, choose what feels most worth discussing.\n\n- Fred",
    cta_label: 'Start',
  },
  thank_you: {
    headline: 'Got it.',
    body: "I'll read every word before we talk. Talk soon.\n\n- Fred",
  },
  email_to: 'NOTIFICATION_EMAIL',
  questions: [
    {
      id: 'growth_priority',
      type: 'single_select_letter',
      text: 'Which Hercules business line should get the most growth attention over the next 12 months?',
      emphasis: ['most growth attention'],
      helper: "Closest answer is enough. We'll unpack why live.",
      options: [
        { key: 'A', label: 'Packaging' },
        { key: 'B', label: 'Outdoor amenities' },
        { key: 'C', label: '3PL' },
        { key: 'D', label: 'Two lines are tied' },
        { key: 'E', label: 'Not sure yet - use the call to clarify' },
      ],
    },
    {
      id: 'primary_leak',
      type: 'multi_select_letter',
      text: 'Where does a good opportunity most often slow down or get lost today?',
      emphasis: ['slow down or get lost'],
      helper: 'Choose any that apply. This is the first leak I want to understand.',
      options: [
        { key: 'A', label: 'Wrong or low-quality leads' },
        { key: 'B', label: 'Quote speed or quote follow-up' },
        { key: 'C', label: 'Sales handoffs or unclear ownership' },
        { key: 'D', label: 'Paid ads or channel mix' },
        { key: 'E', label: 'Reporting - hard to know what is working' },
      ],
    },
    {
      id: 'what_worked',
      type: 'multi_select_letter',
      text: 'What has actually worked in sales or marketing so far?',
      emphasis: ['actually worked'],
      helper: 'Choose any that apply, even if it was small, uneven, or hard to repeat.',
      options: [
        { key: 'A', label: 'Relationships, referrals, or repeat customers' },
        { key: 'B', label: 'A paid channel or campaign' },
        { key: 'C', label: 'Sales outreach or rep follow-up' },
        { key: 'D', label: 'Trade shows, industry networks, or partners' },
        { key: 'E', label: 'Nothing consistently repeatable yet' },
      ],
    },
    {
      id: 'what_failed',
      type: 'multi_select_letter',
      text: 'What has not worked, or has been hard to make repeatable?',
      emphasis: ['not worked'],
      helper: 'Choose any that apply. This helps me avoid retreading dead ground.',
      options: [
        { key: 'A', label: 'Agencies or outside vendors' },
        { key: 'B', label: 'Paid ads or lead generation' },
        { key: 'C', label: 'CRM, process, or follow-up discipline' },
        { key: 'D', label: 'Hiring, ownership, or internal time' },
        { key: 'E', label: 'Measurement, reporting, or attribution' },
      ],
    },
    {
      id: 'useful_call',
      type: 'multi_select_letter',
      text: 'What would make our call genuinely useful?',
      emphasis: ['genuinely useful'],
      helper: 'Choose any that apply. These are the outcomes I should optimize for.',
      options: [
        { key: 'A', label: 'Find the biggest growth leak' },
        { key: 'B', label: 'Decide whether paid ads are worth pushing' },
        { key: 'C', label: 'Improve quote request and follow-up flow' },
        { key: 'D', label: 'Align on what a good lead looks like' },
        { key: 'E', label: 'Leave with a practical next-step plan' },
      ],
    },
  ],
};

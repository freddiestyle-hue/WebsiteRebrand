// Single source of truth for the /diagnostic page content.
// Edit copy here without touching components.

export interface MetaPair {
  label: string;
  value: string;
}

export interface BicameralHeadline {
  lead: string;
  italic: string;
}

export interface ProcessStep {
  num: string;
  body: string;
}

export interface AltRoute {
  title: string;
  meta: string;
  body: string;
  cta: string;
  href: string;
  external?: boolean;
}

export interface QA {
  q: string;
  a: string;
}

export const diagnostic = {
  hero: {
    stamp: 'Book a diagnostic · Rivett · 2026',
    headline: {
      lead: 'Two weeks. One operator.',
      italic: 'A diagnostic that tells you the truth.',
    } as BicameralHeadline,
    dek: 'A senior operator reads your last quarter, sits in your stack, talks to two of your customers, and writes you a 12-page memo on where revenue is leaking, what is invisible, what to build, and what to stop funding. No deck. No retainer.',
    strip: [
      { label: 'Engagement', value: 'Diagnostic, fixed scope' },
      { label: 'Fee', value: '$3,500 USD' },
      { label: 'Window', value: 'Two weeks, kick-off in 7 days' },
      { label: 'Operator', value: 'Fred Style' },
    ] satisfies MetaPair[],
  },

  whatThisIs: {
    eyebrow: 'What this is',
    headline: {
      lead: 'A senior pair of eyes on your growth system,',
      italic: 'for two weeks.',
    } as BicameralHeadline,
    body: 'You bring the access. I bring fifteen years inside paid acquisition, in-house and consulting, across four continents and roughly $100M of managed spend. Two weeks later you have a written diagnosis: where revenue is leaking, what is invisible, what to build, what to stop funding, and the order to do it in. The fee is fixed. The scope is fixed. The output is a memo you can act on without me.',
  },

  fit: [
    'You are running a profitable business and the growth system is underbuilt.',
    'You have a team or an agency, and you are not sure they are pointed at the right things.',
    'You are about to spend serious money and want a senior operator to read the plan first.',
    'You inherited a stack you did not build and want to know what is worth keeping.',
    'You want one document, not a deck, that tells you what to do.',
  ],

  notFit: [
    'You want a marketing person to run things week to week. That is M03.',
    'You want a junior to take orders. I do not run that way.',
    'You do not have access to your own data, ad accounts, or CRM.',
    'You are looking for a yes-person to validate a plan you have already decided.',
    'You are pre-revenue and need help finding product-market fit. That is a different consultant.',
  ],

  questions: [
    {
      q: 'What is the single most expensive mistake your growth system is currently making?',
      a: 'You probably already know the answer. Write it down. The diagnostic confirms it or names a more expensive one.',
    },
    {
      q: 'If your last quarter ran on autopilot, what would have actually changed?',
      a: 'This separates the work that compounds from the work that just looks busy. The first thing the diagnostic does is draw that line.',
    },
    {
      q: 'Who in your business knows where the leaks are, and have you asked them?',
      a: 'Usually one or two people inside the business already see it. The diagnostic includes a 30-minute conversation with each of them.',
    },
  ] satisfies QA[],

  card: {
    operator: {
      name: 'Fred Style',
      role: 'Founder · Operator · Sole point of contact',
      photoBase: '/img/portrait/fred',
    },
    price: '$3,500',
    unit: 'Fixed · two weeks',
    sub: 'One engagement, $3,500 fixed. Invoiced after the kick-off call. Refundable in week one if it is not a fit.',
    steps: [
      { num: '01', body: 'Book a 30-min kick-off slot below. No payment up front.' },
      { num: '02', body: 'On the call I confirm scope, access, and the two customers I will speak to.' },
      { num: '03', body: 'I read the data, sit in the stack, talk to your customers, and write the memo.' },
      { num: '04', body: 'Memo delivered, week two. I walk through it on a call.' },
      { num: '05', body: 'Decide what is next. M02 build, or you take the memo and run.' },
    ] satisfies ProcessStep[],
    cta: 'Book a kick-off call',
    fine: 'Opens Cal · 30-min slot · No upfront payment',
  },

  routes: [
    {
      title: 'Field Notes',
      meta: '30 notes',
      body: 'Read the work. If the writing lands, the diagnostic will too. If it does not, you have saved $3,500.',
      cta: 'Read the notes →',
      href: '/blog',
    },
    {
      title: 'Short call',
      meta: '15 minutes · free',
      body: 'Not ready for the diagnostic. Open a call, ask one question, decide later. Slots are limited and this is not the default route.',
      cta: 'Open the calendar →',
      href: 'cal:fred-style/discovery',
    },
    {
      title: 'Plain email',
      meta: 'Inside 24 hours',
      body: 'Skip the calendar. Write a paragraph. Tell me what is broken. I will reply with the next move, even if it is not me.',
      cta: 'fred@rivett.tech →',
      href: 'mailto:fred@rivett.tech',
      external: true,
    },
  ] satisfies AltRoute[],
} as const;

// Single Cal event for both the diagnostic kick-off and the short call.
// No Stripe gating; $3,500 is invoiced after the kick-off conversation.
export const CAL_LINK = 'fred-style/discovery';
export const CAL_NAMESPACE = 'rivett';

// Related-notes picker for memo pages.
//
// Given a memo's verdict cells, pick 2-3 blog posts that match the
// strongest finding dimensions. The audit's most-broken signals map
// to specific editorial pieces — when pagespeed is the issue we surface
// the decay note, when measurement is the gap we surface the CRM note,
// and so on.
//
// Falls back to a default trio if no matches are found (rare; the
// verdict cell set always has at least 3 dimensions populated).

import type { Memo, VerdictCell, VerdictIcon } from './memo-schema';

export interface RelatedNote {
  slug: string;
  title: string;
  hook: string;
}

// Slug → title + hook. Hook is the editorial one-liner shown under
// the title in the related-notes card. Curated by hand, not generated.
const BLOG_LIBRARY: Record<string, { title: string; hook: string }> = {
  'your-leads-are-not-cold-they-are-decaying': {
    title: 'Your leads are not cold, they are decaying.',
    hook: 'How load time, response latency, and follow-up gaps quietly write off paid spend.',
  },
  'your-crm-looks-full-but-feels-empty': {
    title: 'Your CRM looks full, but feels empty.',
    hook: 'Why measurement infrastructure without conversion paths is just data theatre.',
  },
  'ai-sdr-crash-was-always-going-to-happen': {
    title: 'The AI SDR crash was always going to happen.',
    hook: 'What happens when you point ads at landing pages that were never tuned to convert.',
  },
  'ai-marketing-operating-system': {
    title: 'An AI marketing operating system.',
    hook: 'Where SEO, AEO, and the new search surfaces fit in the stack you already own.',
  },
  'seven-day-follow-up-queue-without-your-crm': {
    title: 'A seven-day follow-up queue, without your CRM.',
    hook: 'How to recover the open loops your inbox is already closing for you.',
  },
  'anatomy-of-ai-agent': {
    title: 'The anatomy of an AI agent.',
    hook: 'Why the hero, the verdict, and the next move have to live on one page.',
  },
  'ai-cost-problem-payroll-problem': {
    title: 'AI is not a cost problem, it is a payroll problem.',
    hook: 'How to price agent throughput against the salaried work it replaces.',
  },
  'ai-executive-assistant-queue-not-chatbot': {
    title: 'An AI executive assistant is a queue, not a chatbot.',
    hook: 'Why the inbox-shaped UI is wrong, and what the right one looks like.',
  },
  'your-ad-platform-cant-see-past-the-click': {
    title: "Your ad platform can't see past the click.",
    hook: 'What attribution loses the moment it leaves the network and lands on your site.',
  },
  'stop-renting-your-leads': {
    title: 'Stop renting your leads.',
    hook: 'Why the demand-gen motion that built B2B SaaS does not survive the next cycle.',
  },
  'the-boring-middle-of-ai': {
    title: 'The boring middle of AI.',
    hook: 'The work that lives between "we tried a chatbot" and "we shipped an agent".',
  },
  'why-we-built-our-own-sdr-agent': {
    title: 'Why we built our own SDR agent.',
    hook: 'The pipeline jobs Rivett automates, what it cost, what it returns.',
  },
};

// Verdict-icon → ranked list of blog slugs. First match wins. Multiple
// cells can vote for the same blog, but a blog only appears once in the
// final selection.
const ICON_TO_SLUGS: Record<VerdictIcon, string[]> = {
  bolt:      ['your-leads-are-not-cold-they-are-decaying', 'your-ad-platform-cant-see-past-the-click'],          // pagespeed
  bar:       ['your-leads-are-not-cold-they-are-decaying', 'the-boring-middle-of-ai'],                            // bar (perf-y)
  target:    ['ai-sdr-crash-was-always-going-to-happen', 'your-ad-platform-cant-see-past-the-click'],            // ads
  megaphone: ['ai-marketing-operating-system', 'your-ad-platform-cant-see-past-the-click'],                       // ads / paid
  search:    ['ai-marketing-operating-system', 'stop-renting-your-leads'],                                        // seo / aeo
  spark:     ['anatomy-of-ai-agent', 'ai-marketing-operating-system'],                                            // aeo / model surface
  flag:      ['your-crm-looks-full-but-feels-empty', 'seven-day-follow-up-queue-without-your-crm'],               // tracking / measurement
  mail:      ['seven-day-follow-up-queue-without-your-crm', 'your-crm-looks-full-but-feels-empty'],               // email follow-up
  phone:     ['ai-executive-assistant-queue-not-chatbot', 'seven-day-follow-up-queue-without-your-crm'],          // contact / response
  eye:       ['anatomy-of-ai-agent', 'your-ad-platform-cant-see-past-the-click'],                                 // mobile / hero
  clock:     ['seven-day-follow-up-queue-without-your-crm', 'your-leads-are-not-cold-they-are-decaying'],         // response time
};

// Default fallback — three perennial pieces that work for any memo.
const FALLBACK_SLUGS = [
  'your-leads-are-not-cold-they-are-decaying',
  'your-crm-looks-full-but-feels-empty',
  'anatomy-of-ai-agent',
];

/**
 * Pick up to N related notes for a memo. Ranks cells by inferred severity
 * (cells with a warn/halt-tone reading first, then verified-fact cells,
 * then everything else) so the most pressing finding's blog post wins.
 */
export function pickRelatedNotes(memo: Memo, n = 3): RelatedNote[] {
  const ranked = rankCellsBySeverity(memo.verdictCells);
  const picked: string[] = [];
  for (const cell of ranked) {
    const candidates = ICON_TO_SLUGS[cell.icon] ?? [];
    for (const slug of candidates) {
      if (picked.includes(slug)) continue;
      if (!BLOG_LIBRARY[slug]) continue;
      picked.push(slug);
      if (picked.length >= n) break;
    }
    if (picked.length >= n) break;
  }
  // Top up with fallback if we came up short
  for (const slug of FALLBACK_SLUGS) {
    if (picked.length >= n) break;
    if (picked.includes(slug)) continue;
    if (!BLOG_LIBRARY[slug]) continue;
    picked.push(slug);
  }
  return picked.map((slug) => ({ slug, ...BLOG_LIBRARY[slug] }));
}

function rankCellsBySeverity(cells: VerdictCell[]): VerdictCell[] {
  // Cells whose `value` looks numeric-bad (high pagespeed seconds, low
  // scores) sort first. We don't have a structured severity field, so
  // proxy via the value string: longer load times, "missing", "none",
  // "no" all bubble up.
  const weight = (c: VerdictCell): number => {
    const v = (c.value || '').toLowerCase();
    if (v.includes('missing') || v.includes('none') || v.includes('not found')) return 3;
    // Seconds-style values: "10.4s" or "14.0s" — treat anything ≥ 5s as severe.
    const sec = v.match(/(\d+(\.\d+)?)\s*s/);
    if (sec) {
      const n = parseFloat(sec[1]);
      if (n >= 5) return 3;
      if (n >= 2.5) return 2;
    }
    if (v === 'no' || v === '0') return 3;
    if (v === 'yes' || v === 'ok') return 0;
    return 1;
  };
  return [...cells].sort((a, b) => weight(b) - weight(a));
}

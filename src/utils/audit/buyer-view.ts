// Buyer-view assembly. Turns a memo into the 3-consequence buyer layer for
// /audit/b/[slug] (the A/B variant prototype). Every buyer-facing sentence is
// ASSEMBLED here from memo rows - never hand-written per prospect.
//
// Hard rules (brief addendum R1-R7, AI-HQ 2026-06-10):
//   R1 - indictment headlines may only be built from rows tagged
//        reliability='verified' with ok=false ("verified-fail"). Soft-absence
//        and inferred rows can NEVER produce an accusation.
//   R2 - collision suppression: a clause is dropped when another dimension's
//        verified detection contradicts it (e.g. "no chat" vs a chat tool in
//        the stack cell). The row gets trace language instead.
//   R3 - every count is computed from the rows actually rendered, never typed.
//   R4 - money/stat lines carry a named source and render only when the
//        triggering measurement is verified.

import type { Memo, VerdictCell, VerdictCheck, VerdictIcon } from './memo-schema';

export type ConsequenceKey = 'spend' | 'find' | 'land';
export type ConsequenceStatus = 'leaking' | 'invisible' | 'at-risk' | 'sound' | 'unconfirmed';

export interface BuyerLead {
  /** Big display headline, assembled from verified rows only. */
  headline: string;
  /** Supporting paragraph, assembled clause-by-clause from verified rows. */
  body: string;
  /** Sourced stat line. Null unless its triggering measurement is verified. */
  stat: { text: string; source: string } | null;
  /** The verified rows the headline is built from - rendered as receipts. */
  receipts: string[];
}

export interface Consequence {
  key: ConsequenceKey;
  status: ConsequenceStatus;
  statusLabel: string;
  heading: string;
  /** Prose body - only for sound/unconfirmed states. Empty for problems. */
  body: string;
  /**
   * Problem states render the verified failures as MARKED ROWS, not prose:
   * engine row labels stripped of their ×-mark read as positives ("Tappable
   * phone number.") and joining them into sentences flips their polarity.
   */
  failRows: string[];
  owner: string | null; // "who should have caught it" - only when status is a problem
  ignored: string | null; // "if you ignore it" - only when status is a problem
  cells: VerdictCell[]; // the evidence drawers, engine rows verbatim
}

export interface BuyerView {
  lead: BuyerLead;
  consequences: Consequence[];
  appendixCells: VerdictCell[];
  counts: { problems: number; sound: number; unconfirmed: number; cellsScanned: number };
}

// Dimension → consequence mapping (locked in the design brief).
// flag (D-09 stack) is appendix-only: no buyer ever cared about a tech count.
const CONSEQUENCE_OF: Partial<Record<VerdictIcon, ConsequenceKey>> = {
  megaphone: 'spend', // D-05 ads
  target: 'spend', //    D-04 measurement
  bolt: 'spend', //      D-03 speed
  eye: 'spend', //       D-06 conversion
  phone: 'spend', //     D-07 mobile
  search: 'find', //     D-01 search
  spark: 'find', //      D-02 AI readability
  mail: 'land', //       D-08 email
};

const isLoadBearing = (c: VerdictCheck) => (c.weight ?? 1) > 0;
const isVerifiedFail = (c: VerdictCheck) => c.ok === false && c.reliability === 'verified' && isLoadBearing(c);
const isVerifiedPass = (c: VerdictCheck) => c.ok === true && (c.reliability === 'verified' || c.reliability == null);

// Ads-presence rows are observations, not defects: "no active ads" is not a
// leak for a prospect that doesn't run ads, and citing it as one hands a
// defensive reader the kill shot. The ads cell stays visible in the evidence
// drawer; it just never drives an indictment or a problem status.
const isIndictable = (cell: VerdictCell) => cell.icon !== 'megaphone';

function cellsFor(memo: Memo, key: ConsequenceKey): VerdictCell[] {
  return memo.verdictCells.filter((cell) => CONSEQUENCE_OF[cell.icon] === key);
}

function checksOf(cells: VerdictCell[]): VerdictCheck[] {
  return cells.flatMap((c) => c.checks);
}

// ---------------------------------------------------------------------------
// Collision table (R2). Each entry: if the suppressing predicate matches any
// verified row anywhere in the memo, rows matching `target` are excluded from
// indictment assembly and annotated with trace language in the drawers.
// ---------------------------------------------------------------------------

interface Collision {
  /** matches the absence row that must not be asserted */
  target: RegExp;
  /** matches the verified detection that contradicts it */
  suppressor: RegExp;
  traceText: string;
}

const COLLISIONS: Collision[] = [
  {
    target: /chat/i,
    suppressor: /chat|intercom|drift|tawk|crisp/i,
    traceText: 'A chat widget loaded late in the render - I could not confirm a buyer reaches it.',
  },
];

function activeCollisions(memo: Memo): Collision[] {
  const detections = memo.verdictCells
    .flatMap((cell) => cell.checks)
    .filter((c) => c.ok === true)
    .map((c) => c.text);
  return COLLISIONS.filter((col) => detections.some((t) => col.suppressor.test(t)));
}

/** True when this failing row is contradicted by a verified detection elsewhere. */
export function isSuppressed(memo: Memo, check: VerdictCheck): boolean {
  if (check.ok !== false) return false;
  return activeCollisions(memo).some((col) => col.target.test(check.text));
}

export function traceTextFor(memo: Memo, check: VerdictCheck): string | null {
  if (check.ok !== false) return null;
  const col = activeCollisions(memo).find((c) => c.target.test(check.text));
  return col ? col.traceText : null;
}

// ---------------------------------------------------------------------------
// Lead assembly (R1). Clause templates keyed by verified engine rows. Values
// are extracted from the rows themselves; if extraction fails the clause is
// dropped, never guessed.
// ---------------------------------------------------------------------------

function lcpSeconds(memo: Memo): number | null {
  // The speed cell note carries the engine's own measurement, e.g.
  // "Borderline. 5.9s LCP, 5.1s FCP on mobile." Extract; never invent.
  const speedCell = memo.verdictCells.find((c) => c.icon === 'bolt');
  if (!speedCell) return null;
  const m = speedCell.note.match(/([\d.]+)\s*s\s*(?:LCP|to render)/i);
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

interface ConversionFacts {
  /** The engine's own verified-pass path row, quoted verbatim - never paraphrased. */
  pathWorksRow: VerdictCheck | null;
  pathVerifiedBroken: VerdictCheck | null; // engine clicked and hit a dead end
  noTel: boolean;
  noScheduling: boolean;
  noAboveFoldCta: boolean;
}

function conversionFacts(memo: Memo): ConversionFacts {
  const cells = memo.verdictCells.filter((c) => c.icon === 'eye');
  const checks = checksOf(cells);
  const byText = (re: RegExp) => checks.filter((c) => re.test(c.text));
  const pathRows = byText(/click|form|path|convert/i);
  return {
    pathWorksRow: pathRows.find((c) => isVerifiedPass(c) && /reach|submittable|form/i.test(c.text)) ?? null,
    pathVerifiedBroken:
      pathRows.find((c) => isVerifiedFail(c) && /did not reach|no way to convert|dead/i.test(c.text)) ?? null,
    noTel: byText(/phone|tel/i).some(isVerifiedFail),
    noScheduling: byText(/schedul|calendly|booking/i).some(isVerifiedFail),
    noAboveFoldCta: byText(/call.to.action|cta|above.the.fold|prominent/i).some(isVerifiedFail),
  };
}

const GOOGLE_MOBILE_STAT = {
  text: '53% of mobile visits abandon a page that takes over 3 seconds to load',
  source: 'Google mobile page-speed research',
};

function assembleLead(memo: Memo): BuyerLead {
  const receipts: string[] = [];
  const lcp = lcpSeconds(memo);
  const conv = conversionFacts(memo);
  const speedFails = checksOf(memo.verdictCells.filter((c) => c.icon === 'bolt')).filter(isVerifiedFail);
  const slowVerified = lcp != null && lcp > 2.5 && speedFails.length > 0;

  const clauses: string[] = [];
  let headline = '';

  if (conv.pathVerifiedBroken) {
    // Strongest possible lead: the engine clicked and the path dead-ended.
    headline = 'I followed your own call-to-action. It leads nowhere.';
    clauses.push(conv.pathVerifiedBroken.text);
    receipts.push(conv.pathVerifiedBroken.text);
    if (slowVerified) {
      clauses.push(`And the page takes ${lcp}s to paint on a phone before a buyer even gets that far.`);
      receipts.push(...speedFails.map((c) => c.text));
    }
  } else if (slowVerified) {
    headline = `A buyer on a phone waits ${lcp} seconds.`;
    clauses.push(
      `I rendered ${memo.domain} on a phone-sized screen the way a buyer sees it. The main content takes ${lcp} seconds to paint. Google's threshold for good is 2.5.`,
    );
    receipts.push(...speedFails.map((c) => c.text));
    // Entry-path clauses: each renders ONLY on a verified-fail row, and the
    // working-form fact is stated as working when the engine verified it (K-01 guard).
    const missing: string[] = [];
    if (conv.noTel) missing.push('no phone number to tap');
    if (conv.noScheduling) missing.push('no booking link');
    if (conv.noAboveFoldCta) missing.push('no button above the fold');
    if (missing.length > 0) {
      // K-01 guard: when the engine verified the path works, say so in the
      // engine's own words - quoted, never paraphrased into "one click" or
      // any other detail this memo didn't measure.
      clauses.push(
        conv.pathWorksRow
          ? `Once it paints there is ${missing.join(', ')}. The form path itself checks out - the scan's own row: "${conv.pathWorksRow.text.trim()}" Everything hangs on a buyer waiting for it.`
          : `Once it paints there is ${missing.join(', ')}.`,
      );
    }
  } else {
    // No verified-fail strong enough to lead with: fall back to the engine's
    // own deterministic synthesis, but ONLY if it is verified (R1).
    const primary = memo.synthesis?.primaryIssue;
    if (primary && primary.reliability === 'verified') {
      headline = 'The strongest verified finding.';
      clauses.push(primary.summary);
      receipts.push(primary.summary);
    } else {
      headline = 'What I could verify from the outside.';
      clauses.push(
        'No single verified failure dominates this read. The findings below are ranked by what returns the most for the least work.',
      );
    }
  }

  return {
    headline,
    body: clauses.join(' '),
    stat: slowVerified ? GOOGLE_MOBILE_STAT : null,
    receipts,
  };
}

// ---------------------------------------------------------------------------
// Consequence assembly
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ConsequenceStatus, string> = {
  leaking: 'Leaking',
  invisible: 'Invisible',
  'at-risk': 'At risk',
  sound: 'Sound',
  unconfirmed: 'Unconfirmed',
};

const PROBLEM_STATUS: Record<ConsequenceKey, ConsequenceStatus> = {
  spend: 'leaking',
  find: 'invisible',
  land: 'at-risk',
};

interface ConsequenceTemplate {
  headingProblem: string;
  headingSound: string;
  headingUnconfirmed: string;
  owner: string;
  ignored: string;
}

const TEMPLATES: Record<ConsequenceKey, ConsequenceTemplate> = {
  spend: {
    headingProblem: 'Money you spend on traffic is leaking before it converts.',
    headingSound: 'The path from click to enquiry holds up.',
    headingUnconfirmed: 'The click-to-enquiry path could not be fully confirmed from outside.',
    owner: 'Whoever ships and measures the website. These rows are checkable in an afternoon.',
    ignored:
      'Ignored, every dollar you later put into ads or outreach pays full price for visits that never become enquiries.',
  },
  find: {
    headingProblem: "The next buyer searches. You don't come up everywhere they look.",
    headingSound: 'Search and AI surfaces can read you.',
    headingUnconfirmed: 'Search visibility could not be fully confirmed from outside.',
    owner: 'Whoever runs your SEO. Or nobody - some of these conventions are new and most agencies have not picked them up.',
    ignored: 'Ignored, answers about your space keep getting written without you in them.',
  },
  land: {
    headingProblem: 'The emails you send risk the spam folder.',
    headingSound: 'When you reach out, it lands.',
    headingUnconfirmed: 'Email authentication could not be fully confirmed from outside.',
    owner: 'Whoever set up your email domain. This is DNS records, not a project.',
    ignored: 'Ignored, quotes and follow-ups quietly stop reaching inboxes and nobody sees it happen.',
  },
};

function indictableFails(memo: Memo, cells: VerdictCell[]): VerdictCheck[] {
  return cells
    .filter(isIndictable)
    .flatMap((c) => c.checks)
    .filter((c) => isVerifiedFail(c) && !isSuppressed(memo, c));
}

function consequenceStatus(memo: Memo, key: ConsequenceKey, cells: VerdictCell[]): ConsequenceStatus {
  if (indictableFails(memo, cells).length > 0) return PROBLEM_STATUS[key];
  const checks = checksOf(cells.filter(isIndictable)).filter(isLoadBearing);
  const softFails = checks.filter((c) => c.ok === false && c.reliability === 'soft-absence');
  if (softFails.length > 0) return 'unconfirmed';
  return 'sound';
}

function consequenceBody(cells: VerdictCell[], status: ConsequenceStatus): string {
  if (status === 'unconfirmed') {
    return 'The scan could not confirm these from outside - the rows below say exactly what was and was not observable.';
  }
  if (status === 'sound') {
    // Positive state: the engine's own cell notes, which celebrate honestly.
    return cells
      .slice(0, 2)
      .map((c) => sentence(c.note))
      .join(' ');
  }
  return '';
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function assembleBuyerView(memo: Memo): BuyerView {
  const keys: ConsequenceKey[] = ['spend', 'find', 'land'];
  const consequences: Consequence[] = keys.map((key) => {
    const cells = cellsFor(memo, key);
    const status = consequenceStatus(memo, key, cells);
    const isProblem = status === 'leaking' || status === 'invisible' || status === 'at-risk';
    const t = TEMPLATES[key];
    return {
      key,
      status,
      statusLabel: STATUS_LABEL[status],
      heading: isProblem ? t.headingProblem : status === 'sound' ? t.headingSound : t.headingUnconfirmed,
      body: consequenceBody(cells, status),
      failRows: isProblem ? indictableFails(memo, cells).map((c) => c.text) : [],
      owner: isProblem ? t.owner : null,
      ignored: isProblem ? t.ignored : null,
      cells,
    };
  });

  // R3: counts derive from the consequences actually assembled.
  const problems = consequences.filter((c) => c.status === 'leaking' || c.status === 'invisible' || c.status === 'at-risk').length;
  const sound = consequences.filter((c) => c.status === 'sound').length;
  const unconfirmed = consequences.filter((c) => c.status === 'unconfirmed').length;

  return {
    lead: assembleLead(memo),
    consequences,
    appendixCells: memo.verdictCells.filter((cell) => CONSEQUENCE_OF[cell.icon] == null),
    counts: { problems, sound, unconfirmed, cellsScanned: memo.verdictCells.length },
  };
}

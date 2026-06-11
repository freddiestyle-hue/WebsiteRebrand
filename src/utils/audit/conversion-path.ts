// Conversion-path trace (Upgrade 4). The conversion checks answer "is there a
// form somewhere on the site". This answers the operation question: a visitor
// lands on the homepage, finds the main call-to-action, clicks it - how many
// clicks until they reach a form they can actually submit?
//
// pickPrimaryCta is pure (no DOM, no browser) so it is unit-testable. The
// headless pass enumerates the page's clickable elements into CtaCandidates,
// this ranks them, and headless-check.ts clicks the winner.

// One clickable element observed on the page.
export interface CtaCandidate {
  index: number; // stable handle back to the enumerated DOM element
  text: string;
  tag: 'a' | 'button';
  classId: string; // class + id, lowercased
  href: string | null;
  area: number; // rendered width * height, in px^2
  aboveFold: boolean;
}

export interface PrimaryCta {
  index: number;
  text: string;
}

// Where the trace ended up, and how far the nearest form is.
export type ConversionPathOutcome =
  | 'form-on-homepage' // a submittable form was already on the page at load
  | 'form-after-click' // clicking the primary CTA reached a form
  | 'no-form-reached' // the CTA was clicked but no form appeared within one click
  | 'no-cta' // no clear primary CTA to follow
  | 'trace-failed'; // the click / trace errored out

export interface ConversionPathResult {
  primaryCtaText: string | null;
  outcome: ConversionPathOutcome;
  // 0 = form already on the homepage, 1 = one click from the CTA, null = further or unknown.
  clicksToForm: number | null;
}

// High-intent CTA wording - the verbs a primary conversion button uses.
// Four families covered: B2B SaaS / services ("book a demo"), ecommerce / D2C
// ("shop now", "add to cart"), lead-gen / finance ("apply now", "get a
// callback"), and staffing / marketplace ("start hiring", "find talent" -
// added after somewhere.com's "Start Hiring" header CTA was invisible to the
// picker and the trace clicked a nav Search button instead). The picker fails
// closed when nothing matches, so missing a vocabulary means we silently skip
// a whole class of prospect.
const HIGH_INTENT =
  /\b(get started|start (free|now|hiring)|free trial|try (it )?free|book (a |your )?(call|demo|consult\w*|appointment|tour|session|visit)|request (a |your )?(quote|demo|call|consult\w*|info|information|brochure|tour|callback)|get (a |your )?(quote|estimate|demo|callback|started|in touch)|schedule (a |your )?(call|demo|consult\w*|appointment|tour|visit)|talk to (us|sales|an expert|a specialist)|contact us|get in touch|book now|enquire|enquir(e|y)|inquire|claim your|sign up|join (now|today|free|the)|create (a |an |your )?account|register|apply (now|today|here)|see (our )?(pricing|plans|prices)|view (our )?(pricing|plans|prices)|get (the |a |our )?(app|free)|download|free (consultation|estimate|quote|assessment|audit)|find (out|your)|learn how|see how (it )?works|watch (a |the )?demo|shop( all| now| the| our)?|buy( now| it)?|add to (cart|bag)|order now|browse (our )?(collection|store|shop)|view (the |our |all )?(collection|products|store)|see (the |our )?(collection|catalog)|reserve (your |a )?(spot|seat|space|table)|donate( now| today)?|give (now|today)|volunteer|pledge|hire (now|today|top|talent|remote|offshore|with)|find talent|post a (job|role)|hire (a |an )?(va|developer|designer|assistant|team))\b/i;

// Class / id fragments that mark an element as a primary call-to-action.
const CTA_CLASS = /\b(cta|btn-primary|primary-cta|hero-cta|btn-cta|action-btn|primary-button)\b/i;

// Hrefs that are terminal actions, not steps toward a form.
const SKIP_HREF = /^\s*(mailto:|tel:)/i;

/**
 * Rank the page's clickable elements and return the primary call-to-action -
 * the button or link a visitor is most likely meant to click first. An
 * element must self-identify as a CTA (by its wording or its class) to be
 * considered; prominence then breaks ties. Returns null when nothing on the
 * page reads as a real CTA. Pure.
 */
export function pickPrimaryCta(candidates: CtaCandidate[]): PrimaryCta | null {
  let best: { cand: CtaCandidate; score: number } | null = null;
  for (const c of candidates) {
    const text = c.text.trim();
    if (!text || text.length > 48) continue;
    if (c.href !== null && SKIP_HREF.test(c.href)) continue;

    const hiText = HIGH_INTENT.test(text);
    const ctaClass = CTA_CLASS.test(c.classId);
    // Must read as a CTA by its wording or its class - otherwise it is just a
    // link, and clicking a random nav link is not a conversion-path trace.
    if (!hiText && !ctaClass) continue;

    let score = 0;
    if (hiText) score += 4;
    if (ctaClass) score += 2;
    if (c.aboveFold) score += 2;
    if (c.tag === 'button') score += 1;
    if (c.area >= 800) score += 1;

    // Strict > keeps the earlier element on a tie - the primary CTA usually
    // appears first, in the hero.
    if (best === null || score > best.score) {
      best = { cand: c, score };
    }
  }
  return best ? { index: best.cand.index, text: best.cand.text.trim() } : null;
}

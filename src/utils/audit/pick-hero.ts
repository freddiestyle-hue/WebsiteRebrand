import type { Memo, VerdictCell, VerdictIcon } from './memo-schema';

export type HeroDimension =
  | 'ads_landing'
  | 'conversion'
  | 'mobile'
  | 'email'
  | 'pagespeed'
  | 'seo'
  | 'aeo'
  | 'tracking'
  | 'ads'
  | 'stack'
  | 'clean';

export type HeroStrength = 'high' | 'medium' | 'low' | 'clean';

export interface HeroFinding {
  dimension: HeroDimension;
  strength: HeroStrength;
  cellHeading: string;
  diagnosis: string;
  // Single-sentence punch of the hero finding, suitable for interpolation
  // into LinkedIn DMs ({hero_one_liner}). Operator-voice, specific number
  // when available, names the leak not the fix.
  oneLiner: string;
  revenueMath?: string;
  ctaSubtext: string;
  sourceCell?: VerdictCell;
}

const ICON_TO_DIMENSION: Partial<Record<VerdictIcon, Exclude<HeroDimension, 'clean' | 'ads_landing'>>> = {
  eye: 'conversion',
  phone: 'mobile',
  mail: 'email',
  bolt: 'pagespeed',
  search: 'seo',
  spark: 'aeo',
  target: 'tracking',
  megaphone: 'ads',
  flag: 'stack',
};

// Threshold for "landing page being penalised by ad platforms." Google's
// Lighthouse bands: 0-49 poor, 50-89 needs improvement, 90+ good. Both
// Google's Quality Score and Meta's destination-experience signal penalise
// across both the "poor" and lower half of "needs improvement" range.
// 70 is conservative on the side of catching the issue, not undercalling it.
const ADS_LANDING_PSI_THRESHOLD = 70;

// Verified-only check reader. Returns the labels of checks whose reliability is
// 'verified' (or untagged, treated as verified) AND that failed. Soft-absence
// failures never qualify - we don't lead with what we couldn't measure.
function verifiedFailLabels(cell?: VerdictCell): string[] {
  if (!cell) return [];
  return cell.checks
    .filter((c) => !c.ok && (c.reliability ?? 'verified') !== 'soft-absence')
    .map((c) => c.text);
}

function hasVerifiedFails(cell?: VerdictCell): boolean {
  return verifiedFailLabels(cell).length > 0;
}

// Operator-voice diagnosis sentences. Plainspoken, dollar-aware, no jargon.
// First-pass draft - Fred edits these before send.
const DIAGNOSIS: Record<Exclude<HeroDimension, 'clean' | 'ads_landing'>, string> = {
  conversion:
    'You\'re paying for traffic to land on a page with no clear next step. The phone number is buried, the form is below the fold, and most visitors leave without doing anything you can measure.',
  mobile:
    'On mobile, your phone number isn\'t tappable, your primary CTA falls below the first screen, and the form is harder to complete on the device most of your traffic uses.',
  email:
    'Your domain is missing SPF or DMARC. Cold emails from your team are getting silently filtered before anyone reads them, which means the deals you\'re chasing through outbound are dying in spam folders.',
  pagespeed:
    'Your homepage is slow to render its main content on mobile. That\'s the point most paid-ad clicks bounce, before seeing a single offer.',
  seo:
    'Your title tag, H1, or meta description is empty or generic. That\'s the difference between Google understanding what you sell and Google guessing.',
  aeo:
    'ChatGPT, Claude, and Perplexity can\'t structure your services in a way they can quote. When an operator asks AI for a vendor like you, you don\'t get cited. Your competitors who structured their pages do.',
  tracking:
    'Your site fires tracking pixels but doesn\'t track the events that actually predict revenue. You\'re paying for visibility into traffic you can\'t correlate to deals.',
  ads:
    'You\'re running ads, but they land on your homepage instead of a page built to convert. Every click is paying full-funnel CAC to drop visitors into a generic experience. A dedicated landing page usually lifts conversion 2-3x at the same spend.',
  stack:
    'Your site runs on an older builder platform with no in-house person to maintain it. Fine until it breaks. The day it breaks, you find out how expensive emergency dev work is.',
};

const CTA_SUBTEXT =
  'Full teardown of the other 8 dimensions, prioritized by revenue impact. 30 min with Fred.';

// Per-dimension one-liner builder. Reads the cell's actual VERIFIED failed
// checks and composes a sentence from them. Never asserts something we
// couldn't measure (soft-absence rows are excluded upstream). Falls back to
// a calibrated dimension-level statement only when we have verified
// evidence the cell as a whole is failing.
function buildOneLiner(
  dim: Exclude<HeroDimension, 'clean' | 'ads_landing'>,
  cell: VerdictCell,
): string {
  const labels = verifiedFailLabels(cell);

  switch (dim) {
    case 'conversion': {
      // Specific verified failures - phrase them straight.
      const phone = labels.find((l) => /phone/i.test(l));
      const form = labels.find((l) => /form/i.test(l));
      const cta = labels.find((l) => /cta|call.?to.?action/i.test(l));
      const sched = labels.find((l) => /schedul/i.test(l));
      const path = labels.find((l) => /conversion path/i.test(l));
      const parts: string[] = [];
      if (path) parts.push('the primary CTA does not reach a form in one click');
      if (form && !path) parts.push('there is no form on the homepage');
      if (cta && !path) parts.push('there is no clear above-the-fold CTA');
      if (phone) parts.push('the phone number is not tappable');
      if (sched) parts.push('there is no self-serve scheduling');
      if (parts.length === 0) {
        return 'The conversion path has verified gaps a cold visitor would hit.';
      }
      const joined =
        parts.length === 1
          ? parts[0]
          : parts.length === 2
            ? `${parts[0]} and ${parts[1]}`
            : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
      return `Paid clicks land on a page where ${joined}.`;
    }
    case 'mobile': {
      const tap = labels.find((l) => /tap.target/i.test(l));
      const viewport = labels.find((l) => /viewport/i.test(l));
      const zoom = labels.find((l) => /zoom/i.test(l));
      const font = labels.find((l) => /font/i.test(l));
      const parts: string[] = [];
      if (viewport) parts.push('the viewport meta tag is missing');
      if (zoom) parts.push('zoom is blocked');
      if (tap) parts.push(tap.toLowerCase().includes('px') ? tap.toLowerCase() : 'tap targets are too small');
      if (font) parts.push('text falls under 12px on mobile');
      if (parts.length === 0) {
        return 'Mobile render has verified issues that affect how visitors interact with the page.';
      }
      const joined = parts.length === 1 ? parts[0] : parts.join(', ');
      return `On mobile, ${joined}.`;
    }
    case 'email': {
      const spf = labels.find((l) => /spf/i.test(l));
      const dmarc = labels.find((l) => /dmarc/i.test(l));
      const mx = labels.find((l) => /mx/i.test(l));
      const missing: string[] = [];
      if (spf) missing.push('SPF');
      if (dmarc) missing.push('DMARC');
      if (mx) missing.push('MX');
      if (missing.length === 0) return 'Mail authentication has a verified gap that puts outbound at deliverability risk.';
      return `Your sending domain is missing ${missing.join(' and ')} - outbound risks the spam folder.`;
    }
    case 'pagespeed': {
      const lcp = labels.find((l) => /largest content/i.test(l));
      const fcp = labels.find((l) => /first content/i.test(l));
      const cls = labels.find((l) => /layout shift/i.test(l));
      const inp = labels.find((l) => /tap responsiveness/i.test(l));
      const verifiedFails = [lcp, fcp, cls, inp].filter(Boolean).length;
      if (verifiedFails >= 3) {
        return 'Mobile Core Web Vitals miss Google\'s thresholds on multiple metrics - paid clicks bounce before the offer renders.';
      }
      if (lcp) return 'Mobile largest-content paint misses Google\'s 2.5s threshold - paid clicks bounce before the offer renders.';
      if (cls) return 'Mobile layout shift exceeds Google\'s threshold - the page jumps as it loads.';
      if (inp) return 'Mobile tap responsiveness exceeds Google\'s 200ms threshold - the page feels laggy.';
      return 'Mobile page-speed has verified gaps against Google\'s thresholds.';
    }
    case 'seo': {
      const checks = labels.map((l) => l.toLowerCase());
      const items: string[] = [];
      if (checks.some((l) => /sitemap/i.test(l))) items.push('sitemap');
      if (checks.some((l) => /robots/i.test(l))) items.push('robots.txt');
      if (checks.some((l) => /canonical/i.test(l))) items.push('canonical');
      if (checks.some((l) => /og.?type|open.?graph/i.test(l))) items.push('Open Graph');
      if (checks.some((l) => /json.?ld|schema/i.test(l))) items.push('schema');
      if (items.length === 0) return 'Search-hygiene has verified gaps in how Google reads this site.';
      return `Search-hygiene gaps verified: ${items.join(', ')} - Google sees less than the site actually has.`;
    }
    case 'aeo': {
      const checks = labels.map((l) => l.toLowerCase());
      const missing: string[] = [];
      if (checks.some((l) => /llms\.txt/i.test(l))) missing.push('/llms.txt');
      if (checks.some((l) => /contact/i.test(l))) missing.push('reachable contact');
      if (checks.some((l) => /trust/i.test(l))) missing.push('visible trust signals');
      if (missing.length === 0) return 'AEO signals have verified gaps - ChatGPT and Perplexity have less to cite than your competitors do.';
      return `AEO gaps verified: missing ${missing.join(', ')} - ChatGPT and Perplexity cite the competitors who structured these.`;
    }
    case 'tracking': {
      // Pull specific tool names when the labels carry them; otherwise stay
      // generic. We never invent a count in the fallback copy.
      const tools: string[] = [];
      for (const l of labels) {
        const m = l.match(/^(Meta Pixel|GA4|Google Analytics|Google Tag Manager|LinkedIn Insight|TikTok Pixel|PostHog|Google Ads Conversion|Reddit Pixel)/i);
        if (m) tools.push(m[1]);
      }
      if (tools.length > 0) {
        return `Tracking gaps verified: ${tools.join(', ')} not firing - paid budget is going to events you cannot attribute.`;
      }
      return 'Tracking has verified firing gaps - paid budget is going to events you cannot measure.';
    }
    case 'ads': {
      return 'Verified ad-platform gaps - landing pages or creative are leaving paid budget on the table.';
    }
    case 'stack': {
      return 'Tech stack has verified gaps - the platform or fingerprint suggests in-house maintenance risk.';
    }
  }
}

function buildAdsLandingOneLiner(score: number): string {
  return `Paid clicks land on a page scoring ${score}/100 - Google's penalising the spend with higher CPC and throttled delivery.`;
}

const CLEAN_ONE_LINER =
  "Site reads clean on the surface - worth a 15 min comparison of what your competitors aren't doing well off-page.";

function cellByIcon(memo: Memo): Map<VerdictIcon, VerdictCell> {
  const m = new Map<VerdictIcon, VerdictCell>();
  for (const cell of memo.verdictCells) m.set(cell.icon, cell);
  return m;
}

function failedChecks(cell?: VerdictCell): number {
  if (!cell) return 0;
  return cell.checks.filter((c) => !c.ok).length;
}

function cellFails(cell?: VerdictCell): boolean {
  return failedChecks(cell) > 0;
}

// Best heuristic from the synthesized cell: 'megaphone' cell with any positive
// signal in its value/note means the prospect is spending. The synthesizer
// writes "Running ads" / "Active campaigns" / counts into `value` when ads
// are detected, and "No active ads" / "None" when not.
function hasPaidAdsSignal(cells: Map<VerdictIcon, VerdictCell>): boolean {
  const ads = cells.get('megaphone');
  if (!ads) return false;
  const blob = `${ads.value} ${ads.note}`.toLowerCase();
  if (/no active|none|not running|0 ads|no ads|nothing/.test(blob)) return false;
  return /\bads?\b|campaign|spending|live|running|active/.test(blob);
}

function strengthFor(cell: VerdictCell): HeroStrength {
  const failed = failedChecks(cell);
  if (failed >= 2) return 'high';
  if (failed === 1) return 'medium';
  return 'low';
}

function buildHero(
  dimension: Exclude<HeroDimension, 'clean' | 'ads_landing'>,
  cell: VerdictCell,
  revenueMath?: string,
): HeroFinding {
  return {
    dimension,
    strength: strengthFor(cell),
    cellHeading: cell.heading,
    diagnosis: DIAGNOSIS[dimension],
    oneLiner: buildOneLiner(dimension, cell),
    revenueMath,
    ctaSubtext: CTA_SUBTEXT,
    sourceCell: cell,
  };
}

// Parses landing-page rows the megaphone cell adds when ads are running,
// shaped like "Ad landing /lp/quote: 23 of 100 · 3 of 4 trackers missing".
// Returns the worst landing-page PSI score seen, or null if none parseable.
function worstAdsLandingScore(cell?: VerdictCell): { score: number; checkText: string } | null {
  if (!cell) return null;
  let worst: { score: number; checkText: string } | null = null;
  for (const c of cell.checks) {
    if (!/Ad landing/i.test(c.text)) continue;
    const m = c.text.match(/(\d{1,3})\s*of\s*100/);
    if (!m) continue;
    const score = parseInt(m[1], 10);
    if (Number.isNaN(score) || score < 0 || score > 100) continue;
    if (!worst || score < worst.score) worst = { score, checkText: c.text };
  }
  return worst;
}

function buildAdsLandingHero(cell: VerdictCell, score: number): HeroFinding {
  // Tier the language by Lighthouse band. Both bands trigger ad-platform
  // penalties; the "poor" band is the headline-grabbing version.
  const band = score < 50 ? 'poor' : 'needs-improvement';
  const bandText =
    band === 'poor'
      ? "That's in Google's \"poor\" band. Quality Score drops, CPC inflates, ad delivery throttles."
      : "That's in Google's \"needs improvement\" band. Enough to drag your Quality Score and inflate your CPC.";
  // Google is the only ad-platform claim the audit can stand behind right now
  // (ads-check.ts withholds Meta/LinkedIn counts), so the hero must not name
  // them. Saying "ad platform" keeps the diagnosis truthful whether the
  // prospect runs only Google or also runs Meta/LinkedIn we can't verify.
  const diagnosis =
    `You're paying for ad clicks that land on a page scoring ${score}/100 for performance. ` +
    `${bandText} The visitors who do land bounce before the page renders. ` +
    `You're paying twice for every click - once in higher bids, once in visitors who never see your offer.`;

  return {
    dimension: 'ads_landing',
    strength: band === 'poor' ? 'high' : 'medium',
    cellHeading: cell.heading,
    diagnosis,
    oneLiner: buildAdsLandingOneLiner(score),
    ctaSubtext: CTA_SUBTEXT,
    sourceCell: cell,
  };
}

function cleanFallback(): HeroFinding {
  return {
    dimension: 'clean',
    strength: 'clean',
    cellHeading: 'Nothing leaking',
    diagnosis:
      'Your site looks tight on the surface. Worth a 15-minute call to compare notes on what your competitors aren\'t doing well, and whether the levers worth pulling are off-site (ads, email, pipeline) rather than on-site.',
    oneLiner: CLEAN_ONE_LINER,
    ctaSubtext: CTA_SUBTEXT,
  };
}

/**
 * Walks the verdict cells in priority order. The tier walk only considers
 * dimensions with at least one VERIFIED failed check - soft-absence failures
 * (HTML parses that false-negative, scrapers a CMP gated) never get heroed.
 *
 *   0. Paid ads landing on a page being penalised by Quality Score (PSI < 70)
 *   1. Conversion path fails on a paid-ads site (verified)
 *   2. Mobile UX critical fails (verified)
 *   3. Email deliverability (SPF/DMARC) fails (verified)
 *   4. PageSpeed critical fails on a paid-ads site (verified)
 *   5. SEO basics (title/H1/meta) fail (verified)
 *   6. AEO / tracking / stack fail (verified)
 *
 * If nothing fails with verified evidence: returns a 'clean' finding so the
 * caller can skip the prospect or send a different angle. We never lead with
 * an unverified leak.
 */
export function pickHeroFinding(memo: Memo): HeroFinding {
  const cells = cellByIcon(memo);
  const paidAds = hasPaidAdsSignal(cells);

  // Tier 0: ads running AND a landing page is in Quality-Score-penalty range.
  // Most dollar-quantifiable hero possible: the prospect is paying twice
  // (inflated CPC + bounced visitors) and we can name the exact score.
  if (paidAds) {
    const megaphone = cells.get('megaphone');
    const worst = worstAdsLandingScore(megaphone);
    if (worst && worst.score < ADS_LANDING_PSI_THRESHOLD) {
      return buildAdsLandingHero(megaphone!, worst.score);
    }
  }

  // Tier 1: conversion fails on a paid-ads site (revenue-at-risk, dollar-quantifiable)
  const eye = cells.get('eye');
  if (paidAds && hasVerifiedFails(eye)) return buildHero('conversion', eye!);

  // Tier 2: mobile UX critical (require 2+ verified fails to hero)
  const phone = cells.get('phone');
  if (hasVerifiedFails(phone) && verifiedFailLabels(phone).length >= 2) return buildHero('mobile', phone!);

  // Tier 3: email deliverability
  const mail = cells.get('mail');
  if (hasVerifiedFails(mail)) return buildHero('email', mail!);

  // Tier 4: pagespeed critical on a paid-ads site (require 2+ verified Core
  // Vitals fails - a single LCP miss is noisy and not enough to hero)
  const bolt = cells.get('bolt');
  if (paidAds && hasVerifiedFails(bolt) && verifiedFailLabels(bolt).length >= 2) return buildHero('pagespeed', bolt!);

  // Tier 5: SEO basics
  const search = cells.get('search');
  if (hasVerifiedFails(search)) return buildHero('seo', search!);

  // Tier 6a: mobile UX any-fail (catches medium severity not covered above)
  if (hasVerifiedFails(phone)) return buildHero('mobile', phone!);

  // Tier 6b: pagespeed any-fail (no paid ads context, still require 2+ verified)
  if (hasVerifiedFails(bolt) && verifiedFailLabels(bolt).length >= 2) return buildHero('pagespeed', bolt!);

  // Tier 6c: ads issues (running but to homepage / weak creative)
  const megaphone = cells.get('megaphone');
  if (hasVerifiedFails(megaphone)) return buildHero('ads', megaphone!);

  // Tier 6d: AEO / tracking / stack
  const spark = cells.get('spark');
  if (hasVerifiedFails(spark)) return buildHero('aeo', spark!);

  const target = cells.get('target');
  if (hasVerifiedFails(target)) return buildHero('tracking', target!);

  const flag = cells.get('flag');
  if (hasVerifiedFails(flag)) return buildHero('stack', flag!);

  return cleanFallback();
}

/** Lightweight summary suitable for the bulk-audit output CSV. */
export interface HeroSummary {
  dimension: HeroDimension;
  strength: HeroStrength;
  diagnosis: string;
}

export function summarizeHero(memo: Memo): HeroSummary {
  const h = pickHeroFinding(memo);
  return { dimension: h.dimension, strength: h.strength, diagnosis: h.diagnosis };
}

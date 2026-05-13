/**
 * Tracking-stack detection from raw HTML. Pure functions, no I/O.
 *
 * Lives in its own file so we can test the regexes against real-shape
 * fixtures without going through runAudit() (which has an SSRF guard that
 * blocks localhost fixture servers in tests).
 *
 * History: an earlier `tracking-gtm` regex looked for the literal URL
 * `googletagmanager.com/gtm.js?id=GTM-XXX`. Google's standard minified GTM
 * snippet builds that URL at runtime, so the literal never appears in the
 * source HTML — only the GTM-ID and the dataLayer string do. rivett.tech
 * (which ships GTM-NRVH45PF the standard way) was being reported as having
 * no GTM container.
 */

export interface TrackingDetection {
  gtm: { detected: boolean; gtmId?: string; via: 'id' | 'host+datalayer' | null };
  ga4: { detected: boolean; direct: boolean; gid?: string };
  metaPixel: boolean;
  linkedinInsight: boolean;
  tiktokPixel: boolean;
  postHog: boolean;
}

const GTM_ID_RE = /\bGTM-[A-Z0-9]{4,12}\b/;
const GTM_HOST_RE = /googletagmanager\.com/i;
const DATALAYER_RE = /['"]dataLayer['"]|\bdataLayer\s*=/;

const GA4_GTAG_CONFIG_RE = /gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+['"]/;
const GA4_GTAG_SCRIPT_RE = /googletagmanager\.com\/gtag\/js\?id=G-/i;
const GA4_GID_RE = /\bG-[A-Z0-9]{8,12}\b/;

const META_PIXEL_RE = /fbq\s*\(|connect\.facebook\.net\/[^"' >]+\/fbevents\.js/i;
const LINKEDIN_RE = /lintrk\s*\(|_linkedin_data_partner_ids/;
const TIKTOK_RE = /ttq\s*\.|tiktok\.com\/i18n\/pixel\/events\.js/i;
const POSTHOG_RE = /posthog\.init\s*\(|us\.i\.posthog\.com|eu\.i\.posthog\.com|app\.posthog\.com/i;

export function detectGtm(html: string): TrackingDetection['gtm'] {
  const idMatch = html.match(GTM_ID_RE);
  if (idMatch) {
    return { detected: true, gtmId: idMatch[0], via: 'id' };
  }
  if (GTM_HOST_RE.test(html) && DATALAYER_RE.test(html)) {
    return { detected: true, via: 'host+datalayer' };
  }
  return { detected: false, via: null };
}

export function detectGa4(html: string, gtmDetected: boolean): TrackingDetection['ga4'] {
  const directConfig = GA4_GTAG_CONFIG_RE.test(html);
  const directScript = GA4_GTAG_SCRIPT_RE.test(html);
  const literalGid = html.match(GA4_GID_RE);
  const direct = directConfig || directScript || !!literalGid;
  if (direct) {
    return {
      detected: true,
      direct: true,
      gid: literalGid ? literalGid[0] : undefined,
    };
  }
  // Indirect: GTM container present → GA4 most likely loaded inside it.
  // We cannot verify without executing JS, but this beats reporting GA4 as
  // missing on every GTM-using site (i.e. most operators).
  if (gtmDetected) {
    return { detected: true, direct: false };
  }
  return { detected: false, direct: false };
}

export function detectTracking(html: string): TrackingDetection {
  const gtm = detectGtm(html);
  return {
    gtm,
    ga4: detectGa4(html, gtm.detected),
    metaPixel: META_PIXEL_RE.test(html),
    linkedinInsight: LINKEDIN_RE.test(html),
    tiktokPixel: TIKTOK_RE.test(html),
    postHog: POSTHOG_RE.test(html),
  };
}

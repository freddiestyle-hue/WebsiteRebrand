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

/**
 * Upgrade 3 - measurement truth.
 *
 * The detectTracking* functions above answer "is the tag's code on the page".
 * The helpers below interpret what the headless pass observed at runtime - the
 * actual beacon requests the browser made and the events it fired. The
 * headless capture lives in headless-check.ts; the parsing is here so it stays
 * pure and unit-testable.
 */

// Hostnames whose requests are analytics / ads beacons worth capturing.
// Suffix-matched, so subdomains (region1.google-analytics.com,
// www.facebook.com, us.i.posthog.com) are all covered.
export const TRACKING_BEACON_HOSTS = [
  'facebook.com',
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'px.ads.linkedin.com',
  'analytics.tiktok.com',
  'i.posthog.com',
  'app.posthog.com',
] as const;

export function isTrackingHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return TRACKING_BEACON_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

export type TrackingVendor =
  | 'metaPixel'
  | 'ga4'
  | 'gtm'
  | 'linkedinInsight'
  | 'tiktokPixel'
  | 'postHog';

export interface ParsedBeacon {
  vendor: TrackingVendor;
  // Event names lifted from the request's query params, when the vendor
  // encodes them there (Meta `ev`, GA4 `en`). Empty for vendors that do not.
  events: string[];
}

/**
 * Identify a captured beacon request URL: which vendor it belongs to, and any
 * event names in its query params. Returns null for URLs that are not
 * recognized beacons.
 */
export function parseBeacon(rawUrl: string): ParsedBeacon | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  const q = u.searchParams;

  // Meta Pixel beacon: www.facebook.com/tr?id=...&ev=PageView
  if ((host === 'facebook.com' || host.endsWith('.facebook.com')) && path.startsWith('/tr')) {
    const ev = q.get('ev');
    return { vendor: 'metaPixel', events: ev ? [ev] : [] };
  }
  // GA4 Measurement Protocol: google-analytics.com/g/collect?...&en=page_view
  if (
    host === 'google-analytics.com' ||
    host.endsWith('.google-analytics.com') ||
    host === 'analytics.google.com'
  ) {
    const en = q.get('en');
    return { vendor: 'ga4', events: en ? [en] : [] };
  }
  // GTM container / gtag loader.
  if (host === 'googletagmanager.com' || host.endsWith('.googletagmanager.com')) {
    return { vendor: 'gtm', events: [] };
  }
  if (host === 'px.ads.linkedin.com') {
    return { vendor: 'linkedinInsight', events: [] };
  }
  if (host === 'analytics.tiktok.com') {
    return { vendor: 'tiktokPixel', events: [] };
  }
  if (host === 'app.posthog.com' || host === 'i.posthog.com' || host.endsWith('.i.posthog.com')) {
    return { vendor: 'postHog', events: [] };
  }
  return null;
}

// The runtime capture from the headless pass (HeadlessResult['tracking']).
export interface HeadlessTrackingCapture {
  // Full URLs of requests to known analytics/ads beacon hosts.
  beaconUrls: string[];
  // Event names pushed to window.dataLayer (GTM's event bus).
  dataLayerEvents: string[];
  // GTM container IDs (GTM-XXXX) registered on the live page.
  gtmContainerIds: string[];
  // GA4 measurement IDs (G-XXXX) registered on the live page.
  ga4MeasurementIds: string[];
}

// Four honest states for a tracker, weakest to strongest:
//   absent          - no code on the page, no requests seen
//   present         - tag code is on the page, but not observed running
//   firing          - the browser was seen sending a request to the vendor
//   events-observed - specific named events were seen in the traffic
export type TrackingState = 'absent' | 'present' | 'firing' | 'events-observed';

export interface PixelMeasurement {
  state: TrackingState;
  events: string[];
}

export type TrackingMeasurement = Record<TrackingVendor, PixelMeasurement>;

/**
 * Combine the static HTML detection (is the tag's code present) with the
 * headless runtime capture (did it actually fire, and with what events) into
 * one honest measurement per vendor. Pure - the headless capture is gathered
 * in headless-check.ts and passed in. When `headless` is null (no headless
 * pass) every vendor degrades to present-or-absent from the static scan.
 */
export function measureTracking(
  staticDetection: TrackingDetection,
  headless: HeadlessTrackingCapture | null,
): TrackingMeasurement {
  const beacons = (headless?.beaconUrls ?? [])
    .map(parseBeacon)
    .filter((b): b is ParsedBeacon => b !== null);

  const eventsFor = (vendor: TrackingVendor): string[] => {
    const set = new Set<string>();
    for (const b of beacons) {
      if (b.vendor === vendor) for (const e of b.events) set.add(e);
    }
    return [...set].sort();
  };
  const firedFor = (vendor: TrackingVendor): boolean =>
    beacons.some((b) => b.vendor === vendor);

  const resolve = (
    staticPresent: boolean,
    fired: boolean,
    events: string[],
  ): PixelMeasurement => {
    if (events.length > 0) return { state: 'events-observed', events };
    if (fired) return { state: 'firing', events: [] };
    if (staticPresent) return { state: 'present', events: [] };
    return { state: 'absent', events: [] };
  };

  // GTM's events live in the dataLayer (its event bus); a registered container
  // ID confirms the container is running even before any beacon is seen.
  const gtmEvents = [...new Set(headless?.dataLayerEvents ?? [])].sort();
  const gtmFired = firedFor('gtm') || (headless?.gtmContainerIds.length ?? 0) > 0;
  const ga4Fired = firedFor('ga4') || (headless?.ga4MeasurementIds.length ?? 0) > 0;

  return {
    metaPixel: resolve(staticDetection.metaPixel, firedFor('metaPixel'), eventsFor('metaPixel')),
    ga4: resolve(staticDetection.ga4.detected, ga4Fired, eventsFor('ga4')),
    gtm: resolve(staticDetection.gtm.detected, gtmFired, gtmEvents),
    linkedinInsight: resolve(staticDetection.linkedinInsight, firedFor('linkedinInsight'), []),
    tiktokPixel: resolve(staticDetection.tiktokPixel, firedFor('tiktokPixel'), []),
    postHog: resolve(staticDetection.postHog, firedFor('postHog'), []),
  };
}

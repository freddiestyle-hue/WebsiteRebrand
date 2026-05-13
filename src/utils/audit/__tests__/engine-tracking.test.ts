import { describe, it, expect } from 'vitest';
import { detectTracking, detectGtm, detectGa4 } from '../tracking';

/**
 * Regression tests for the tracking-stack detection.
 *
 * History: an earlier `tracking-gtm` regex looked for the literal URL
 * `googletagmanager.com/gtm.js?id=GTM-XXX` in the HTML. Google's standard
 * minified GTM snippet builds that URL at runtime, so the literal never
 * appears in the source — only the GTM-ID and the "dataLayer" string do.
 * rivett.tech (which ships GTM-NRVH45PF the standard way) was being
 * reported as having no GTM container.
 *
 * Same class of bug hits GA4: when loaded via GTM (most operators), the
 * G-ID lives in the container, not in the static HTML. We degrade to
 * "indirect detection" so the check doesn't false-negative on every site
 * that uses GTM.
 */

const GOOGLE_GTM_SNIPPET = `<!doctype html>
<html><head><title>fixture</title>
<script>
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-NRVH45PF');
</script>
</head><body><h1>fixture</h1></body></html>`;

const DIRECT_GA4 = `<!doctype html>
<html><head><title>direct</title>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'G-ABC123XYZ');</script>
</head><body></body></html>`;

const META_PIXEL = `<!doctype html>
<html><head><title>fb</title>
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)}}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','000000');</script>
</head><body></body></html>`;

const POSTHOG = `<!doctype html>
<html><head>
<script>posthog.init('phc_xyz', { api_host: 'https://us.i.posthog.com' });</script>
</head><body></body></html>`;

const PLAIN = `<!doctype html><html><head><title>plain</title></head><body><h1>nothing</h1></body></html>`;

describe('detectGtm', () => {
  it('detects via GTM-ID literal in minified Google snippet (rivett.tech regression)', () => {
    const out = detectGtm(GOOGLE_GTM_SNIPPET);
    expect(out.detected).toBe(true);
    expect(out.gtmId).toBe('GTM-NRVH45PF');
    expect(out.via).toBe('id');
  });

  it('detects via host + dataLayer when no GTM-ID literal is present', () => {
    const html = `<script>console.log('googletagmanager.com'); window.dataLayer = window.dataLayer || [];</script>`;
    const out = detectGtm(html);
    expect(out.detected).toBe(true);
    expect(out.via).toBe('host+datalayer');
  });

  it('returns false on plain HTML', () => {
    const out = detectGtm(PLAIN);
    expect(out.detected).toBe(false);
    expect(out.via).toBe(null);
  });

  it('does not match unrelated text that contains GTM-', () => {
    const html = `<p>Read about GTM- standards online.</p>`;
    const out = detectGtm(html);
    expect(out.detected).toBe(false);
  });
});

describe('detectGa4', () => {
  it('detects direct GA4 via gtag config', () => {
    const out = detectGa4(DIRECT_GA4, /* gtmDetected */ false);
    expect(out.detected).toBe(true);
    expect(out.direct).toBe(true);
    expect(out.gid).toBe('G-ABC123XYZ');
  });

  it('infers GA4 likely via GTM when GTM is detected but no direct config', () => {
    const out = detectGa4(GOOGLE_GTM_SNIPPET, /* gtmDetected */ true);
    expect(out.detected).toBe(true);
    expect(out.direct).toBe(false);
    expect(out.gid).toBeUndefined();
  });

  it('returns false on plain HTML with no GTM', () => {
    const out = detectGa4(PLAIN, /* gtmDetected */ false);
    expect(out.detected).toBe(false);
  });

  it('does not falsely infer GA4 when GTM is absent and HTML is empty', () => {
    const out = detectGa4('', false);
    expect(out.detected).toBe(false);
  });
});

describe('detectTracking (full pipeline)', () => {
  it('rivett.tech-style snippet → GTM + GA4 (indirect) both detected', () => {
    const out = detectTracking(GOOGLE_GTM_SNIPPET);
    expect(out.gtm.detected).toBe(true);
    expect(out.gtm.gtmId).toBe('GTM-NRVH45PF');
    expect(out.ga4.detected).toBe(true);
    expect(out.ga4.direct).toBe(false);
    expect(out.metaPixel).toBe(false);
    expect(out.postHog).toBe(false);
  });

  it('Meta Pixel via fbq()', () => {
    expect(detectTracking(META_PIXEL).metaPixel).toBe(true);
  });

  it('PostHog via posthog.init', () => {
    expect(detectTracking(POSTHOG).postHog).toBe(true);
  });

  it('plain HTML → nothing detected', () => {
    const out = detectTracking(PLAIN);
    expect(out.gtm.detected).toBe(false);
    expect(out.ga4.detected).toBe(false);
    expect(out.metaPixel).toBe(false);
    expect(out.postHog).toBe(false);
    expect(out.linkedinInsight).toBe(false);
    expect(out.tiktokPixel).toBe(false);
  });
});

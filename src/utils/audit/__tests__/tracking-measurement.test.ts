import { describe, it, expect } from 'vitest';
import {
  isTrackingHost,
  parseBeacon,
  measureTracking,
  type TrackingDetection,
  type TrackingState,
  type HeadlessTrackingCapture,
} from '../tracking';
import { trackingRowText, buildTrackingCell, type EnrichmentBundle } from '../v3-synth';
import type { CheckResult } from '../engine';
import type { HeadlessResult } from '../headless-check';

/**
 * Upgrade 3 - measurement truth. Tests for the pure parsing + state logic:
 * isTrackingHost, parseBeacon, and measureTracking. The headless capture
 * itself runs on Vercel (Linux-only chromium); this is the logic that
 * interprets what it captured.
 */

describe('isTrackingHost', () => {
  it('matches known beacon hosts exactly and by subdomain', () => {
    expect(isTrackingHost('facebook.com')).toBe(true);
    expect(isTrackingHost('www.facebook.com')).toBe(true);
    expect(isTrackingHost('region1.google-analytics.com')).toBe(true);
    expect(isTrackingHost('www.googletagmanager.com')).toBe(true);
    expect(isTrackingHost('us.i.posthog.com')).toBe(true);
    expect(isTrackingHost('px.ads.linkedin.com')).toBe(true);
  });
  it('rejects unrelated hosts and suffix-match tricks', () => {
    expect(isTrackingHost('example.com')).toBe(false);
    expect(isTrackingHost('cdn.shopify.com')).toBe(false);
    // notfacebook.com must not match facebook.com
    expect(isTrackingHost('notfacebook.com')).toBe(false);
  });
});

describe('parseBeacon', () => {
  it('parses a Meta Pixel beacon and lifts the ev event', () => {
    const b = parseBeacon('https://www.facebook.com/tr/?id=123&ev=PageView&noscript=1');
    expect(b).toEqual({ vendor: 'metaPixel', events: ['PageView'] });
  });
  it('parses a GA4 collect beacon and lifts the en event', () => {
    const b = parseBeacon('https://www.google-analytics.com/g/collect?v=2&en=page_view');
    expect(b).toEqual({ vendor: 'ga4', events: ['page_view'] });
  });
  it('parses a GA4 beacon with no event as ga4 with no events', () => {
    const b = parseBeacon('https://region1.google-analytics.com/g/collect?v=2');
    expect(b).toEqual({ vendor: 'ga4', events: [] });
  });
  it('identifies GTM, LinkedIn, TikTok, and PostHog hosts', () => {
    expect(parseBeacon('https://www.googletagmanager.com/gtm.js?id=GTM-X')?.vendor).toBe('gtm');
    expect(parseBeacon('https://px.ads.linkedin.com/collect?x=1')?.vendor).toBe('linkedinInsight');
    expect(parseBeacon('https://analytics.tiktok.com/api/v2/pixel')?.vendor).toBe('tiktokPixel');
    expect(parseBeacon('https://us.i.posthog.com/e/')?.vendor).toBe('postHog');
  });
  it('returns null for non-beacon URLs and garbage', () => {
    expect(parseBeacon('https://example.com/page')).toBeNull();
    expect(parseBeacon('not a url')).toBeNull();
    // facebook.com, but not the /tr beacon path
    expect(parseBeacon('https://www.facebook.com/sharer')).toBeNull();
  });
});

function staticDetection(
  on: Partial<{
    gtm: boolean;
    ga4: boolean;
    metaPixel: boolean;
    linkedinInsight: boolean;
    tiktokPixel: boolean;
    postHog: boolean;
  }> = {},
): TrackingDetection {
  return {
    gtm: { detected: on.gtm ?? false, via: on.gtm ? 'id' : null },
    ga4: { detected: on.ga4 ?? false, direct: on.ga4 ?? false },
    metaPixel: on.metaPixel ?? false,
    linkedinInsight: on.linkedinInsight ?? false,
    tiktokPixel: on.tiktokPixel ?? false,
    postHog: on.postHog ?? false,
  };
}

function capture(over: Partial<HeadlessTrackingCapture> = {}): HeadlessTrackingCapture {
  return {
    beaconUrls: over.beaconUrls ?? [],
    dataLayerEvents: over.dataLayerEvents ?? [],
    gtmContainerIds: over.gtmContainerIds ?? [],
    ga4MeasurementIds: over.ga4MeasurementIds ?? [],
  };
}

describe('measureTracking', () => {
  it('no headless pass: vendors degrade to present (static) or absent', () => {
    const m = measureTracking(staticDetection({ metaPixel: true }), null);
    expect(m.metaPixel.state).toBe('present');
    expect(m.metaPixel.events).toEqual([]);
    expect(m.ga4.state).toBe('absent');
  });

  it('a beacon with a named event yields events-observed', () => {
    const m = measureTracking(
      staticDetection({ metaPixel: true }),
      capture({ beaconUrls: ['https://www.facebook.com/tr/?id=1&ev=Lead'] }),
    );
    expect(m.metaPixel.state).toBe('events-observed');
    expect(m.metaPixel.events).toEqual(['Lead']);
  });

  it('a beacon with no extractable event yields firing', () => {
    const m = measureTracking(
      staticDetection({ tiktokPixel: true }),
      capture({ beaconUrls: ['https://analytics.tiktok.com/api/v2/pixel'] }),
    );
    expect(m.tiktokPixel.state).toBe('firing');
    expect(m.tiktokPixel.events).toEqual([]);
  });

  it('headless catches a pixel the static scan missed (absent -> events-observed)', () => {
    const m = measureTracking(
      staticDetection({ metaPixel: false }),
      capture({ beaconUrls: ['https://www.facebook.com/tr/?id=1&ev=PageView'] }),
    );
    expect(m.metaPixel.state).toBe('events-observed');
  });

  it('GTM: a registered container ID is firing; dataLayer events are events-observed', () => {
    const firingOnly = measureTracking(
      staticDetection({ gtm: true }),
      capture({ gtmContainerIds: ['GTM-ABCD'] }),
    );
    expect(firingOnly.gtm.state).toBe('firing');

    const withEvents = measureTracking(
      staticDetection({ gtm: true }),
      capture({ gtmContainerIds: ['GTM-ABCD'], dataLayerEvents: ['gtm.js', 'form_submit'] }),
    );
    expect(withEvents.gtm.state).toBe('events-observed');
    expect(withEvents.gtm.events).toEqual(['form_submit', 'gtm.js']);
  });

  it('GA4: a registered measurement ID counts as firing', () => {
    const m = measureTracking(
      staticDetection({ ga4: true }),
      capture({ ga4MeasurementIds: ['G-ABCDEF12'] }),
    );
    expect(m.ga4.state).toBe('firing');
  });

  it('GA4: a collect beacon with an en event yields events-observed', () => {
    const m = measureTracking(
      staticDetection({ ga4: true }),
      capture({ beaconUrls: ['https://www.google-analytics.com/g/collect?en=purchase'] }),
    );
    expect(m.ga4.state).toBe('events-observed');
    expect(m.ga4.events).toEqual(['purchase']);
  });

  it('empty capture with no static presence: every vendor absent', () => {
    const m = measureTracking(staticDetection(), capture());
    for (const v of Object.values(m)) expect(v.state).toBe('absent');
  });
});

function trackingChecks(states: TrackingState[]): CheckResult[] {
  return states.map((state, i) => ({
    id: `tracking-${i}`,
    category: 'tracking' as const,
    label: `Pixel ${i}`,
    passed: state !== 'absent',
    weight: 1,
    evidence: '',
    finding: '',
    measurement: { state, events: state === 'events-observed' ? ['Lead'] : [] },
  }));
}

function enrichment(over: Partial<EnrichmentBundle> = {}): EnrichmentBundle {
  return {
    deliverability: null,
    mobile: null,
    pageSpeed: null,
    ads: null,
    techStack: null,
    headless: null,
    techStackRuntime: null,
    landing: null,
    ...over,
  };
}

describe('trackingRowText', () => {
  it('events-observed lists the observed event names', () => {
    expect(
      trackingRowText('Meta Pixel', { state: 'events-observed', events: ['PageView', 'Lead'] }),
    ).toBe('Meta Pixel: firing (events: PageView, Lead)');
  });
  it('firing without extracted events', () => {
    expect(trackingRowText('GA4', { state: 'firing', events: [] })).toBe('GA4: firing');
  });
  it('present is honest that firing was not confirmed', () => {
    expect(trackingRowText('Meta Pixel', { state: 'present', events: [] })).toBe(
      'Meta Pixel: installed, not observed firing',
    );
  });
  it('absent', () => {
    expect(trackingRowText('TikTok Pixel', { state: 'absent', events: [] })).toBe(
      'TikTok Pixel: not detected',
    );
  });
});

describe('buildTrackingCell', () => {
  it('with a headless pass, summarises trackers confirmed firing', () => {
    const cell = buildTrackingCell(
      trackingChecks(['events-observed', 'firing', 'present', 'absent']),
      enrichment({ headless: {} as HeadlessResult }),
    );
    expect(cell.value).toBe('2 of 4');
    expect(cell.note).toContain('2 of 4 trackers confirmed firing');
    expect(cell.benchmark).toBe('Pixels · measured live');
  });

  it('without a headless pass, reports page-source presence and flags firing as not measured', () => {
    const cell = buildTrackingCell(trackingChecks(['present', 'present', 'absent']), enrichment());
    expect(cell.value).toBe('2 of 3');
    expect(cell.note).toContain('not measured');
    expect(cell.benchmark).toBe('Pixels · static scan');
  });
});

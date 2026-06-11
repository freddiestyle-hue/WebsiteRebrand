// Unit tests for the ads-running check. This module has been the source of
// every fabrication incident in the engine's history (the recom.co wrong-
// company counts, the credits-depleted-reads-as-zero-ads batch, the silent
// identity-failure rows), and until now had zero coverage. These tests pin
// the safety properties the fixes introduced:
//   1. API/credit errors are never published as a zero-ads result.
//   2. Meta/LinkedIn counts publish only on an exact self-declared identity
//      match; a linked-but-unverified platform is withheld, not guessed.
//   3. LinkedIn counts include only ads from the verified advertiser.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkAds } from '../ads-check';
import type { SocialIdentity } from '../social-identity';

const NO_IDENTITY: SocialIdentity = {
  facebookSlug: null,
  instagramHandle: null,
  linkedinSlug: null,
  tiktokHandle: null,
  siteName: null,
};

// Route fetch by URL substring. Each route returns a JSON body (HTTP 200)
// or a number (bare HTTP status with empty body).
function mockFetch(routes: Array<[match: string, response: unknown | number]>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      for (const [match, response] of routes) {
        if (String(url).includes(match)) {
          if (typeof response === 'number') {
            return new Response('', { status: response });
          }
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      throw new Error(`unmatched fetch in test: ${url}`);
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('SCRAPECREATORS_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('checkAds', () => {
  it('returns null without an API key - never a fabricated result', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', '');
    expect(await checkAds('example.com', NO_IDENTITY)).toBeNull();
  });

  it('depleted credits return null, not a zero-ads result', async () => {
    // The bug that burned a 150-prospect batch: HTTP 200 with success:false
    // used to read as "0 ads found".
    mockFetch([
      ['google/company/ads', { success: false, message: 'You are out of credits' }],
    ]);
    expect(await checkAds('example.com', NO_IDENTITY)).toBeNull();
  });

  it('an auth failure returns null, not a zero-ads result', async () => {
    mockFetch([['google/company/ads', 401]]);
    expect(await checkAds('example.com', NO_IDENTITY)).toBeNull();
  });

  it('a verified Google zero is a real zero, with Meta/LinkedIn unmeasured', async () => {
    mockFetch([['google/company/ads', { results: [] }]]);
    const r = await checkAds('example.com', NO_IDENTITY);
    expect(r).not.toBeNull();
    expect(r!.googleActive).toBe(0);
    expect(r!.metaActive).toBeNull();
    expect(r!.linkedinActive).toBeNull();
    expect(r!.identityStatus).toEqual({ meta: 'no-link', linkedin: 'no-link' });
    expect(r!.commentary).toContain('No active paid ads');
  });

  it('publishes a Meta count only on an exact self-declared alias match', async () => {
    mockFetch([
      ['google/company/ads', { results: [] }],
      [
        'facebook/adLibrary/search/companies',
        {
          searchResults: [
            // A near-miss competitor must not match (the recom.co lesson).
            { page_id: '111', page_alias: 'getmixmaxx', ig_username: null },
            { page_id: '222', page_alias: 'getmixmax', ig_username: 'mixmax' },
          ],
        },
      ],
      ['facebook/adLibrary/company/ads', { number_of_ads_estimate: 7, results: [] }],
    ]);
    const r = await checkAds('mixmax.com', {
      ...NO_IDENTITY,
      facebookSlug: 'getmixmax',
      siteName: 'Mixmax',
    });
    expect(r!.metaActive).toBe(7);
    expect(r!.identityStatus.meta).toBe('verified');
    expect(r!.verifiedBy.meta).toBe('facebook.com/getmixmax');
    // The ads call must have been keyed to the exactly-matched page id.
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes('pageId=222'))).toBe(true);
    expect(calls.some((u) => u.includes('pageId=111'))).toBe(false);
  });

  it('a linked-but-unmatchable Facebook page withholds the count as unverified-link', async () => {
    mockFetch([
      ['google/company/ads', { results: [{ id: 'ad1' }] }],
      ['facebook/adLibrary/search/companies', { searchResults: [] }],
    ]);
    const r = await checkAds('example.com', {
      ...NO_IDENTITY,
      facebookSlug: 'examplecompany',
    });
    expect(r!.metaActive).toBeNull();
    expect(r!.identityStatus.meta).toBe('unverified-link');
    expect(r!.commentary).not.toMatch(/Meta/);
  });

  it('counts only LinkedIn ads from the verified advertiser', async () => {
    mockFetch([
      ['google/company/ads', { results: [] }],
      ['linkedin/company?', { name: 'Mixmax' }],
      [
        'linkedin/ads/search',
        {
          searchResultsCount: 10,
          ads: [
            { advertiser: { name: 'Mixmax' } },
            { advertiser: { name: 'Some Other Co' } },
          ],
        },
      ],
    ]);
    const r = await checkAds('mixmax.com', { ...NO_IDENTITY, linkedinSlug: 'mixmax' });
    // Mixed advertisers on the page: only the exact match counts, and the
    // API's page-spanning total must NOT be trusted.
    expect(r!.linkedinActive).toBe(1);
    expect(r!.identityStatus.linkedin).toBe('verified');
  });

  it('trusts the LinkedIn total only when every returned ad matches the advertiser', async () => {
    mockFetch([
      ['google/company/ads', { results: [] }],
      ['linkedin/company?', { name: 'Mixmax' }],
      [
        'linkedin/ads/search',
        {
          searchResultsCount: 41,
          ads: [{ advertiser: { name: 'Mixmax' } }, { advertiser: { name: 'MIXMAX' } }],
        },
      ],
    ]);
    const r = await checkAds('mixmax.com', { ...NO_IDENTITY, linkedinSlug: 'mixmax' });
    expect(r!.linkedinActive).toBe(41);
  });

  it('a Meta API error after identity resolution stays null, not zero', async () => {
    mockFetch([
      ['google/company/ads', { results: [{ id: 'ad1' }, { id: 'ad2' }] }],
      [
        'facebook/adLibrary/search/companies',
        { searchResults: [{ page_id: '222', page_alias: 'getmixmax' }] },
      ],
      ['facebook/adLibrary/company/ads', { success: false, message: 'out of credits' }],
    ]);
    const r = await checkAds('mixmax.com', { ...NO_IDENTITY, facebookSlug: 'getmixmax' });
    expect(r).not.toBeNull();
    expect(r!.googleActive).toBe(2);
    expect(r!.metaActive).toBeNull();
    // Commentary must not imply Meta was measured.
    expect(r!.commentary).not.toMatch(/Meta \d/);
  });
});

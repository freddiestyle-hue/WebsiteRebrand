import { describe, expect, it, vi, afterEach } from 'vitest';
import { extractSocialIdentity } from '../social-identity';
import { checkAds } from '../ads-check';

describe('extractSocialIdentity', () => {
  it('pulls self-declared profile links from footer markup', () => {
    const html = `
      <footer>
        <a href="https://www.facebook.com/theroofgallery">Facebook</a>
        <a href="https://instagram.com/theroofgallery_ga/">Instagram</a>
        <a href="https://www.linkedin.com/company/the-roof-gallery/">LinkedIn</a>
        <a href="https://www.tiktok.com/@roofgallery">TikTok</a>
      </footer>`;
    const id = extractSocialIdentity(html);
    expect(id.facebookSlug).toBe('theroofgallery');
    expect(id.instagramHandle).toBe('theroofgallery_ga');
    expect(id.linkedinSlug).toBe('the-roof-gallery');
    expect(id.tiktokHandle).toBe('roofgallery');
  });

  it('ignores share/login/plugin facebook paths and IG post links', () => {
    const html = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://www.facebook.com/login.php">login</a>
      <a href="https://instagram.com/p/Cxyz123/">post</a>`;
    const id = extractSocialIdentity(html);
    expect(id.facebookSlug).toBeNull();
    expect(id.instagramHandle).toBeNull();
  });

  it('majority-votes when multiple candidates appear', () => {
    const html = `
      facebook.com/acmecorp facebook.com/acmecorp facebook.com/randomguy`;
    expect(extractSocialIdentity(html).facebookSlug).toBe('acmecorp');
  });

  it('returns all-null on empty html', () => {
    const id = extractSocialIdentity('');
    expect(id).toEqual({
      facebookSlug: null,
      instagramHandle: null,
      linkedinSlug: null,
      tiktokHandle: null,
      siteName: null,
    });
  });

  it('extracts the site name from og:site_name as a search hint', () => {
    const html = `<meta property="og:site_name" content="Mixmax" /><a href="https://facebook.com/getmixmax">fb</a>`;
    const id = extractSocialIdentity(html);
    expect(id.siteName).toBe('Mixmax');
    expect(id.facebookSlug).toBe('getmixmax');
  });
});

describe('checkAds identity verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetch(routes: Record<string, any>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      if (!key) return { ok: true, json: async () => ({}) } as any;
      return { ok: true, json: async () => routes[key] } as any;
    }));
  }

  it('publishes Meta count when page_alias exactly matches the self-declared slug', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'test');
    stubFetch({
      'google/company/ads': { number_of_ads_estimate: 4 },
      'search/companies': {
        searchResults: [
          { page_id: '111', page_alias: 'unrelatedco', page_is_deleted: false },
          { page_id: '222', page_alias: 'acmecorp', page_is_deleted: false },
        ],
      },
      'adLibrary/company/ads': { searchResultsCount: 12, results: [] },
    });
    const r = await checkAds('acme.com', {
      facebookSlug: 'acmecorp', instagramHandle: null, linkedinSlug: null, tiktokHandle: null, siteName: null,
    });
    expect(r?.metaActive).toBe(12);
    expect(r?.googleActive).toBe(4);
    expect(r?.verifiedBy.meta).toBe('facebook.com/acmecorp');
  });

  it('withholds Meta count when no candidate alias matches (recom.co rule)', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'test');
    stubFetch({
      'google/company/ads': { number_of_ads_estimate: 2 },
      'search/companies': {
        searchResults: [{ page_id: '999', page_alias: 'recombee', page_is_deleted: false }],
      },
    });
    const r = await checkAds('recom.co', {
      facebookSlug: 'recomofficial', instagramHandle: null, linkedinSlug: null, tiktokHandle: null, siteName: null,
    });
    expect(r?.metaActive).toBeNull();
    expect(r?.googleActive).toBe(2);
    expect(r?.verifiedBy.meta).toBeNull();
  });

  it('keeps all platform counts null-or-real with no identity at all', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'test');
    stubFetch({ 'google/company/ads': { number_of_ads_estimate: 0 } });
    const r = await checkAds('nolinks.com', {
      facebookSlug: null, instagramHandle: null, linkedinSlug: null, tiktokHandle: null, siteName: null,
    });
    expect(r?.googleActive).toBe(0);
    expect(r?.metaActive).toBeNull();
    expect(r?.linkedinActive).toBeNull();
  });

  it('counts only advertiser-matching LinkedIn ads', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'test');
    stubFetch({
      'google/company/ads': { number_of_ads_estimate: 1 },
      'linkedin/company?': { name: 'Acme Corp' },
      'linkedin/ads/search': {
        searchResultsCount: 50,
        ads: [
          { advertiser: { name: 'Acme Corp' } },
          { advertiser: { name: 'Acme Corporation of Ohio' } },
        ],
      },
    });
    const r = await checkAds('acme.com', {
      facebookSlug: null, instagramHandle: null, linkedinSlug: 'acme-corp', tiktokHandle: null, siteName: null,
    });
    // Mixed advertisers on the page -> count exact matches only, not the API total.
    expect(r?.linkedinActive).toBe(1);
    expect(r?.verifiedBy.linkedin).toBe('linkedin.com/company/acme-corp');
  });
});

describe('checkAds multi-query Meta resolution (Mixmax case)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('finds the page via the site-name query when the slug query misses', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'test');
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('google/company/ads')) return { ok: true, json: async () => ({ number_of_ads_estimate: 6 }) } as any;
      if (u.includes('search/companies')) {
        // slug query returns nothing; site-name query returns the page whose
        // alias matches the prospect's own facebook link
        if (u.includes('getmixmax')) return { ok: true, json: async () => ({ searchResults: [] }) } as any;
        if (u.includes('Mixmax')) return { ok: true, json: async () => ({ searchResults: [
          { page_id: '777', page_alias: 'getmixmax', name: 'Mixmax', page_is_deleted: false },
        ] }) } as any;
      }
      if (u.includes('adLibrary/company/ads')) return { ok: true, json: async () => ({ searchResultsCount: 9, results: [] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await checkAds('mixmax.com', {
      facebookSlug: 'getmixmax', instagramHandle: null, linkedinSlug: null, tiktokHandle: null, siteName: 'Mixmax',
    });
    expect(r?.metaActive).toBe(9);
    expect(r?.verifiedBy.meta).toBe('facebook.com/getmixmax');
    expect(r?.identityStatus.meta).toBe('verified');
  });

  it('marks unverified-link when no query produces an alias match', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'test');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('google/company/ads')) return { ok: true, json: async () => ({ number_of_ads_estimate: 1 }) } as any;
      if (u.includes('search/companies')) return { ok: true, json: async () => ({ searchResults: [
        { page_id: '1', page_alias: 'somethingelse', page_is_deleted: false },
      ] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    }));
    const r = await checkAds('acme.com', {
      facebookSlug: 'acmehq', instagramHandle: null, linkedinSlug: null, tiktokHandle: null, siteName: 'Acme',
    });
    expect(r?.metaActive).toBeNull();
    expect(r?.identityStatus.meta).toBe('unverified-link');
  });
});

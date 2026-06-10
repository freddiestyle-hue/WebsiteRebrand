import { describe, expect, it, vi, afterEach } from 'vitest';
import { validateCandidate } from '../competitor-contrast';

function stubFetchHtml(finalUrl: string, html: string, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    url: finalUrl,
    text: async () => html,
  }) as any));
}

describe('validateCandidate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a real competitor domain', async () => {
    stubFetchHtml('https://www.rivalroofing.com/', '<html><title>Rival Roofing</title></html>');
    const r = await validateCandidate(
      { name: 'Rival Roofing', domain: 'rivalroofing.com', reason: 'same metro' },
      'theroofgallery.com'
    );
    expect(r?.domain).toBe('rivalroofing.com');
  });

  it('rejects the prospect itself and its subdomains', async () => {
    stubFetchHtml('https://shop.theroofgallery.com/', '<html></html>');
    expect(await validateCandidate(
      { name: 'X', domain: 'theroofgallery.com', reason: '' }, 'theroofgallery.com'
    )).toBeNull();
    expect(await validateCandidate(
      { name: 'X', domain: 'shop.theroofgallery.com', reason: '' }, 'www.theroofgallery.com'
    )).toBeNull();
  });

  it('rejects redirects that land back on the prospect', async () => {
    stubFetchHtml('https://www.theroofgallery.com/', '<html></html>');
    expect(await validateCandidate(
      { name: 'Alias Co', domain: 'roofgalleryga.com', reason: '' }, 'theroofgallery.com'
    )).toBeNull();
  });

  it('rejects parked domains (the capsaai.com lesson)', async () => {
    stubFetchHtml('https://capsaai.com/', '<html><title>capsaai.com is for sale</title>GoDaddy</html>');
    expect(await validateCandidate(
      { name: 'Capsa', domain: 'capsaai.com', reason: '' }, 'someprospect.com'
    )).toBeNull();
  });

  it('rejects garbage domains without fetching', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await validateCandidate(
      { name: 'X', domain: 'not a domain!!', reason: '' }, 'prospect.com'
    )).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects dead sites', async () => {
    stubFetchHtml('https://gone.example.com/', '', false);
    expect(await validateCandidate(
      { name: 'Gone', domain: 'gone.example.com', reason: '' }, 'prospect.com'
    )).toBeNull();
  });
});

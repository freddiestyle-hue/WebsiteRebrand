import { describe, it, expect } from 'vitest';
import { parseTotalResults, parseSampleUrls } from '../serp';

/**
 * Upgrade 11 - SerpAPI Google site:domain query. Pure-function tests for
 * the response parsers. The fetch + Upstash cache path is integration-only
 * (covered via the deployed audit verification, not unit-tested here -
 * mocking Upstash + global fetch in bun's vitest is unreliable per the
 * existing crawlPages tests that suffer the same vi.unstubAllGlobals issue).
 */

describe('parseTotalResults (Upgrade 11)', () => {
  it('parses a number from search_information.total_results', () => {
    const data = { search_information: { total_results: 4 } };
    expect(parseTotalResults(data)).toBe(4);
  });

  it('parses a numeric string with commas (Google reports "1,234,567")', () => {
    const data = { search_information: { total_results: '1,234,567' } };
    expect(parseTotalResults(data)).toBe(1234567);
  });

  it('parses a numeric string without commas', () => {
    const data = { search_information: { total_results: '42' } };
    expect(parseTotalResults(data)).toBe(42);
  });

  it('returns null when search_information is missing', () => {
    expect(parseTotalResults({})).toBeNull();
  });

  it('returns null when total_results is missing', () => {
    expect(parseTotalResults({ search_information: {} })).toBeNull();
  });

  it('returns null when total_results is an unparseable string', () => {
    const data = { search_information: { total_results: 'about 42 results' } };
    // parseInt extracts the leading digits, so this returns 'about' -> NaN.
    // But parseInt('about', 10) is NaN, which Number.isFinite rejects.
    expect(parseTotalResults(data)).toBeNull();
  });

  it('returns null for null/undefined/non-object input', () => {
    expect(parseTotalResults(null)).toBeNull();
    expect(parseTotalResults(undefined)).toBeNull();
    expect(parseTotalResults('string')).toBeNull();
    expect(parseTotalResults(42)).toBeNull();
  });

  it('handles zero (legitimate result for a non-indexed site)', () => {
    expect(parseTotalResults({ search_information: { total_results: 0 } })).toBe(0);
  });

  it('rejects Infinity and NaN', () => {
    expect(parseTotalResults({ search_information: { total_results: Infinity } })).toBeNull();
    expect(parseTotalResults({ search_information: { total_results: NaN } })).toBeNull();
  });
});

describe('parseSampleUrls (Upgrade 11)', () => {
  it('extracts up to 5 string links from organic_results', () => {
    const data = {
      organic_results: [
        { link: 'https://acme.com/' },
        { link: 'https://acme.com/about' },
        { link: 'https://acme.com/pricing' },
      ],
    };
    expect(parseSampleUrls(data)).toEqual([
      'https://acme.com/',
      'https://acme.com/about',
      'https://acme.com/pricing',
    ]);
  });

  it('caps at 5 even when more results are present', () => {
    const data = {
      organic_results: Array.from({ length: 12 }, (_, i) => ({
        link: `https://acme.com/page-${i}`,
      })),
    };
    const result = parseSampleUrls(data);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe('https://acme.com/page-0');
    expect(result[4]).toBe('https://acme.com/page-4');
  });

  it('skips entries missing a link field', () => {
    const data = {
      organic_results: [
        { link: 'https://acme.com/' },
        { title: 'no link here' },
        { link: 'https://acme.com/about' },
      ],
    };
    expect(parseSampleUrls(data)).toEqual([
      'https://acme.com/',
      'https://acme.com/about',
    ]);
  });

  it('skips entries with non-string link field', () => {
    const data = {
      organic_results: [
        { link: 'https://acme.com/' },
        { link: 42 },
        { link: null },
        { link: 'https://acme.com/about' },
      ],
    };
    expect(parseSampleUrls(data)).toEqual([
      'https://acme.com/',
      'https://acme.com/about',
    ]);
  });

  it('returns empty array when organic_results is missing', () => {
    expect(parseSampleUrls({})).toEqual([]);
  });

  it('returns empty array when organic_results is not an array', () => {
    expect(parseSampleUrls({ organic_results: 'not-array' })).toEqual([]);
    expect(parseSampleUrls({ organic_results: {} })).toEqual([]);
  });

  it('returns empty array for null/non-object input', () => {
    expect(parseSampleUrls(null)).toEqual([]);
    expect(parseSampleUrls(undefined)).toEqual([]);
    expect(parseSampleUrls('string')).toEqual([]);
  });

  it('handles organic_results entries that are null (defensive)', () => {
    const data = {
      organic_results: [null, { link: 'https://acme.com/' }, null],
    };
    expect(parseSampleUrls(data)).toEqual(['https://acme.com/']);
  });
});

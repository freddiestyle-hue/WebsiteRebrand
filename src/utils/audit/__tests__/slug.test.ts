import { describe, it, expect } from 'vitest';
import { generateSlug, normalizeDomainForSlug, isValidSlug, randomSuffix, SLUG_PATTERN } from '../slug';

const SUFFIX_LEN = 16;

describe('normalizeDomainForSlug', () => {
  it('strips scheme and www', () => {
    expect(normalizeDomainForSlug('https://www.example.com')).toBe('example-com');
  });

  it('lowercases', () => {
    expect(normalizeDomainForSlug('FoO.COM')).toBe('foo-com');
  });

  it('strips path/query', () => {
    expect(normalizeDomainForSlug('https://example.com/some/path?q=1')).toBe('example-com');
  });

  it('handles bare domain', () => {
    expect(normalizeDomainForSlug('bossfueltrailers.com')).toBe('bossfueltrailers-com');
  });

  it('replaces all dots with dashes', () => {
    expect(normalizeDomainForSlug('a.b.c.example.com')).toBe('a-b-c-example-com');
  });

  it('throws on empty', () => {
    expect(() => normalizeDomainForSlug('   ')).toThrow();
  });

  it('throws on missing TLD', () => {
    expect(() => normalizeDomainForSlug('localhost')).toThrow();
  });
});

describe('generateSlug', () => {
  it('produces expected shape with provided suffix', () => {
    const suf = 'abcdefgh12345678'; // 16 chars
    expect(generateSlug('krlawtc.com', suf)).toBe(`krlawtc-com-${suf}`);
  });

  it('produces shape matching SLUG_PATTERN with random suffix', () => {
    const slug = generateSlug('example.com');
    expect(SLUG_PATTERN.test(slug)).toBe(true);
    expect(slug.startsWith('example-com-')).toBe(true);
    expect(slug.length).toBe('example-com-'.length + SUFFIX_LEN);
  });

  it('throws on suffix shorter than 16 chars', () => {
    expect(() => generateSlug('example.com', 'x7k2')).toThrow();
    expect(() => generateSlug('example.com', 'abc')).toThrow();
  });

  it('throws on suffix with uppercase or non-alphanumeric', () => {
    expect(() => generateSlug('example.com', 'ABCDEFGH12345678')).toThrow();
    expect(() => generateSlug('example.com', 'abcd-fgh12345678')).toThrow();
  });
});

describe('randomSuffix', () => {
  it(`produces ${SUFFIX_LEN} chars from [a-z0-9]`, () => {
    for (let i = 0; i < 32; i++) {
      const s = randomSuffix();
      expect(s).toMatch(new RegExp(`^[a-z0-9]{${SUFFIX_LEN}}$`));
    }
  });
});

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('example-com-abcdefgh12345678')).toBe(true);
    expect(isValidSlug('a-b-c-example-com-x7k2abcdefgh1234')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(isValidSlug('example-com')).toBe(false);
    expect(isValidSlug('Example-com-abcdefgh12345678')).toBe(false);
    // 15 chars (one short)
    expect(isValidSlug('example-com-abcdefgh1234567')).toBe(false);
    // 17 chars (one over)
    expect(isValidSlug('example-com-abcdefgh123456789')).toBe(false);
    // legacy 4-char form must now be rejected
    expect(isValidSlug('example-com-a1b2')).toBe(false);
  });
});

// Parity fixtures shared with prospect-teardown/tests/test_slug.py
// If you edit, update both files. TS and Python MUST produce byte-equal output.
const PARITY_FIXTURES: Array<[string, string, string]> = [
  ['krlawtc.com', 'x7k2abcdefgh1234', 'krlawtc-com-x7k2abcdefgh1234'],
  ['https://www.example.com', 'ab12cd34ef56gh78', 'example-com-ab12cd34ef56gh78'],
  ['FoO.COM', '9zz9aabbccdd0000', 'foo-com-9zz9aabbccdd0000'],
  ['a.b.c.example.com', 'test1234abcd5678', 'a-b-c-example-com-test1234abcd5678'],
  ['bossfueltrailers.com', '0000000000000000', 'bossfueltrailers-com-0000000000000000'],
];

describe('parity fixtures (must match Python tests/test_slug.py)', () => {
  it.each(PARITY_FIXTURES)('%s + %s -> %s', (domain, suffix, expected) => {
    expect(generateSlug(domain, suffix)).toBe(expected);
  });
});

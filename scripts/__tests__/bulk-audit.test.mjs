import { describe, it, expect } from 'vitest';
import { parseCsv, writeCsv, successfulDomains, mergeOutputRows } from '../bulk-audit.mjs';

describe('parseCsv / writeCsv', () => {
  it('round-trips rows with quoted commas and escaped quotes', () => {
    const { header, rows } = parseCsv(
      'domain,note\nacme.com,"a, b"\nfoo.com,"she said ""hi"""\n',
    );
    expect(header).toEqual(['domain', 'note']);
    expect(rows).toEqual([
      { domain: 'acme.com', note: 'a, b' },
      { domain: 'foo.com', note: 'she said "hi"' },
    ]);
    expect(parseCsv(writeCsv(['domain', 'note'], rows)).rows).toEqual(rows);
  });
});

describe('successfulDomains', () => {
  it('collects only domains marked success, not failures', () => {
    const done = successfulDomains([
      { domain: 'a.com', success: 'true' },
      { domain: 'b.com', success: 'false' },
      { domain: 'c.com', success: 'true' },
    ]);
    expect([...done].sort()).toEqual(['a.com', 'c.com']);
  });
});

describe('mergeOutputRows', () => {
  const prior = new Map([
    ['a.com', { domain: 'a.com', success: 'true', error: 'carried' }],
    ['b.com', { domain: 'b.com', success: 'false', error: 'old-fail' }],
  ]);

  it('keeps input order and prefers a fresh row over a prior one', () => {
    const fresh = new Map([
      ['b.com', { domain: 'b.com', success: 'true', error: '' }],
      ['c.com', { domain: 'c.com', success: 'true', error: '' }],
    ]);
    const merged = mergeOutputRows(['a.com', 'b.com', 'c.com'], prior, fresh);
    expect(merged.map((r) => r.domain)).toEqual(['a.com', 'b.com', 'c.com']);
    // b.com was retried this run: the fresh row wins over the prior failure.
    expect(merged[1].success).toBe('true');
    // a.com was not re-run: the prior row is carried untouched.
    expect(merged[0].error).toBe('carried');
  });

  it('omits an input domain with neither a fresh nor a prior row', () => {
    const merged = mergeOutputRows(['a.com', 'unreached.com'], prior, new Map());
    expect(merged.map((r) => r.domain)).toEqual(['a.com']);
  });

  it('collapses a domain repeated in the input to one row', () => {
    const merged = mergeOutputRows(['a.com', 'a.com'], prior, new Map());
    expect(merged).toHaveLength(1);
  });
});

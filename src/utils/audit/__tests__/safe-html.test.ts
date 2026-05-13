import { describe, it, expect } from 'vitest';
import { sanitizeMemoHtml, sanitizeMemoHtmlList } from '../safe-html';

describe('sanitizeMemoHtml', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(sanitizeMemoHtml(null)).toBe('');
    expect(sanitizeMemoHtml(undefined)).toBe('');
    expect(sanitizeMemoHtml('')).toBe('');
  });

  it('passes through plain text unchanged in effect', () => {
    expect(sanitizeMemoHtml('hello world')).toBe('hello world');
  });

  it('preserves <code>, <strong>, <em>, <b>, <i>, <br>', () => {
    expect(sanitizeMemoHtml('see <code>install</code> docs')).toBe('see <code>install</code> docs');
    expect(sanitizeMemoHtml('<strong>bold</strong>')).toBe('<strong>bold</strong>');
    expect(sanitizeMemoHtml('<em>italic</em>')).toBe('<em>italic</em>');
    expect(sanitizeMemoHtml('a<br>b')).toBe('a<br>b');
    expect(sanitizeMemoHtml('a<br/>b')).toBe('a<br/>b');
  });

  it('strips <script> tags completely (XSS guard)', () => {
    const out = sanitizeMemoHtml('hi <script>alert(1)</script> there');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script');
  });

  it('strips <img onerror=...> (attribute-based XSS)', () => {
    const out = sanitizeMemoHtml('<img src=x onerror="alert(1)">');
    // The raw < must be encoded so the browser cannot create an <img> element.
    // The string "onerror" still appears as literal text inside the encoded
    // form, but with no live tag around it the handler can never fire.
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('strips <a href=javascript:> tags', () => {
    const out = sanitizeMemoHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('<a ');
    // Verify the contents stay (encoded), so no info is lost
    expect(out).toContain('click');
  });

  it('rejects allowlisted tags with attributes', () => {
    // <strong class="evil"> contains attributes - whole tag should stay encoded
    const out = sanitizeMemoHtml('<strong class="x">bold</strong>');
    expect(out).not.toContain('<strong class');
    expect(out).toContain('&lt;strong');
    // The closing tag IS bare so it can render
    expect(out).toContain('</strong>');
  });

  it('handles nested allowlisted tags', () => {
    const out = sanitizeMemoHtml('<strong><em>bold italic</em></strong>');
    expect(out).toBe('<strong><em>bold italic</em></strong>');
  });

  it('encodes raw < > & " characters in plain text', () => {
    const out = sanitizeMemoHtml('a < b && c > d "quotes"');
    expect(out).toBe('a &lt; b &amp;&amp; c &gt; d &quot;quotes&quot;');
  });

  it('strips DOCTYPE and html/body tags', () => {
    const out = sanitizeMemoHtml('<!DOCTYPE html><html><body>x</body></html>');
    expect(out).not.toContain('<html');
    expect(out).not.toContain('<body');
    expect(out).not.toContain('<!DOCTYPE');
  });

  // No idempotency test — the sanitizer is designed to run once on raw input
  // before rendering. Re-sanitizing already-sanitized output double-encodes
  // entities (intentional: it would be unsafe to detect "is this already
  // encoded?" heuristically). Call sites must run it exactly once per value.
});

describe('sanitizeMemoHtmlList', () => {
  it('returns [] for null/undefined', () => {
    expect(sanitizeMemoHtmlList(null)).toEqual([]);
    expect(sanitizeMemoHtmlList(undefined)).toEqual([]);
  });

  it('sanitizes each element', () => {
    const out = sanitizeMemoHtmlList(['<strong>a</strong>', '<script>x</script>']);
    expect(out[0]).toBe('<strong>a</strong>');
    expect(out[1]).not.toContain('<script');
  });
});

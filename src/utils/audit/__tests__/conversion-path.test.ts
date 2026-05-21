import { describe, it, expect } from 'vitest';
import { pickPrimaryCta, type CtaCandidate } from '../conversion-path';

/**
 * Upgrade 4 - conversion-path trace. Tests for pickPrimaryCta: the pure
 * ranking that decides which clickable element is the prospect's primary
 * call-to-action. The headless click interaction is verified on Vercel.
 */

function cand(over: Partial<CtaCandidate> & { index: number }): CtaCandidate {
  return {
    text: '',
    tag: 'a',
    classId: '',
    href: null,
    area: 5000,
    aboveFold: true,
    ...over,
  };
}

describe('pickPrimaryCta', () => {
  it('picks a high-intent above-the-fold button over plain nav links', () => {
    const picked = pickPrimaryCta([
      cand({ index: 0, text: 'Home', tag: 'a', href: '/' }),
      cand({ index: 1, text: 'Book a call', tag: 'button', classId: 'hero-cta' }),
      cand({ index: 2, text: 'Blog', tag: 'a', href: '/blog' }),
    ]);
    expect(picked?.index).toBe(1);
    expect(picked?.text).toBe('Book a call');
  });

  it('picks an element by its CTA class when the wording is generic', () => {
    const picked = pickPrimaryCta([
      cand({ index: 0, text: 'Learn more', classId: 'btn cta-primary' }),
      cand({ index: 1, text: 'About', href: '/about' }),
    ]);
    expect(picked?.index).toBe(0);
  });

  it('returns null when nothing on the page reads as a CTA', () => {
    const picked = pickPrimaryCta([
      cand({ index: 0, text: 'Home', href: '/' }),
      cand({ index: 1, text: 'Blog', href: '/blog' }),
      cand({ index: 2, text: 'Privacy policy', href: '/privacy' }),
    ]);
    expect(picked).toBeNull();
  });

  it('ignores mailto and tel links even with CTA wording or class', () => {
    const picked = pickPrimaryCta([
      cand({ index: 0, text: 'Contact us', href: 'mailto:hi@acme.com' }),
      cand({ index: 1, text: 'Call us', href: 'tel:+1234567890', classId: 'cta' }),
    ]);
    expect(picked).toBeNull();
  });

  it('prefers the higher-scoring CTA - intent wording beats class alone', () => {
    const picked = pickPrimaryCta([
      cand({ index: 0, text: 'See features', classId: 'cta', aboveFold: false }),
      cand({ index: 1, text: 'Get a quote', tag: 'button', classId: 'hero-cta', aboveFold: true }),
    ]);
    expect(picked?.index).toBe(1);
  });

  it('skips over-long text that is really a paragraph link', () => {
    const picked = pickPrimaryCta([
      cand({
        index: 0,
        text: 'Get started today and book a call with our team to learn how we can help',
        classId: 'cta',
      }),
    ]);
    expect(picked).toBeNull();
  });

  it('breaks ties toward the earlier element', () => {
    const picked = pickPrimaryCta([
      cand({ index: 0, text: 'Get started', tag: 'button', classId: 'cta' }),
      cand({ index: 1, text: 'Get started', tag: 'button', classId: 'cta' }),
    ]);
    expect(picked?.index).toBe(0);
  });
});

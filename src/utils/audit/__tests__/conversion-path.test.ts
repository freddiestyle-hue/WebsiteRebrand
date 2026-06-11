import { describe, it, expect } from 'vitest';
import { pickPrimaryCta, hasAboveFoldCta, type CtaCandidate } from '../conversion-path';

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

  // The picker historically only recognised B2B service vocabulary - "book a
  // demo", "talk to sales". That silently broke for ecommerce / D2C, lead-gen,
  // and non-profit prospects whose primary CTA reads "Shop now", "Apply now",
  // "Donate". Every prospect type in our list needs at least one recognised
  // CTA verb or the conversion-path trace returns no-cta and the audit looks
  // unverified.
  describe('expanded vocabulary by prospect type', () => {
    it.each([
      ['Shop now', 'ecommerce'],
      ['Shop the collection', 'ecommerce'],
      ['Buy now', 'ecommerce'],
      ['Add to cart', 'ecommerce'],
      ['Browse our store', 'ecommerce'],
      ['View products', 'ecommerce'],
      ['Order now', 'ecommerce'],
      ['Apply now', 'finance / lead-gen'],
      ['Get a callback', 'finance / lead-gen'],
      ['Request a callback', 'finance / lead-gen'],
      ['See pricing', 'SaaS'],
      ['View pricing', 'SaaS'],
      ['Watch a demo', 'SaaS'],
      ['Create your account', 'SaaS'],
      ['Register', 'SaaS / event'],
      ['Book a tour', 'real estate / hospitality'],
      ['Reserve your spot', 'event / hospitality'],
      ['Free consultation', 'services'],
      ['Free estimate', 'services'],
      ['Free audit', 'services'],
      ['Donate now', 'non-profit'],
      ['Join today', 'membership / community'],
      ['Download', 'app / lead magnet'],
    ])('"%s" is recognised as a primary CTA (%s prospect type)', (text) => {
      const picked = pickPrimaryCta([
        cand({ index: 0, text: 'Home', href: '/' }),
        cand({ index: 1, text, tag: 'button' }),
      ]);
      expect(picked?.index).toBe(1);
    });
  });
});

describe('pickPrimaryCta - staffing vocabulary (somewhere.com regression)', () => {
  it('"Start Hiring" beats a class-matched nav Search button', () => {
    // The real somewhere.com fold: a "Search" button carrying a cta- class and
    // the actual primary CTA "Start Hiring" with no CTA class. Before the
    // staffing vocabulary landed, the trace clicked Search and reported a
    // false conversion dead-end.
    const picked = pickPrimaryCta([
      cand({ index: 0, text: 'Search', classId: 'cta-header_button w-button', area: 3980 }),
      cand({ index: 1, text: 'Start Hiring', classId: 'btn-animate-chars', area: 3766 }),
    ]);
    expect(picked?.index).toBe(1);
    expect(picked?.text).toBe('Start Hiring');
  });

  it('matches the wider hiring family', () => {
    for (const text of ['Hire now', 'Find Talent', 'Post a job', 'Hire top talent']) {
      const picked = pickPrimaryCta([cand({ index: 0, text })]);
      expect(picked?.index, text).toBe(0);
    }
  });
});

describe('hasAboveFoldCta', () => {
  it('sees a rendered CTA the static regex cannot (char-span text via innerText)', () => {
    expect(hasAboveFoldCta([
      cand({ index: 0, text: 'Start Hiring', classId: 'btn-animate-chars' }),
    ])).toBe(true);
  });

  it('false for below-fold CTAs and plain nav links', () => {
    expect(hasAboveFoldCta([
      cand({ index: 0, text: 'Start Hiring', aboveFold: false }),
      cand({ index: 1, text: 'Blog', href: '/blog' }),
    ])).toBe(false);
  });

  it('ignores tel/mailto even with CTA wording', () => {
    expect(hasAboveFoldCta([
      cand({ index: 0, text: 'Contact us', href: 'mailto:x@y.com' }),
    ])).toBe(false);
  });
});

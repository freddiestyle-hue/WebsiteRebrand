import { SITE_ORIGIN, blogPostUrl } from './canonicalUrl';
import { stripHtml, clamp } from './stripHtml';

const AUTHOR_NAME = 'Fred Style';
const AUTHOR_URL = `${SITE_ORIGIN}/about`;
const ORG_NAME = 'Rivett';
const ORG_LOGO = `${SITE_ORIGIN}/img/marks/wordmark.svg`;
const ORG_SAME_AS = ['https://www.linkedin.com/in/fredstyle/'];

export const personSchema = {
  '@type': 'Person',
  name: AUTHOR_NAME,
  url: AUTHOR_URL,
  sameAs: ORG_SAME_AS,
};

export const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: ORG_NAME,
  url: SITE_ORIGIN,
  logo: { '@type': 'ImageObject', url: ORG_LOGO },
  founder: personSchema,
  sameAs: ORG_SAME_AS,
};

export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: ORG_NAME,
  url: SITE_ORIGIN,
  publisher: { '@type': 'Organization', name: ORG_NAME, url: SITE_ORIGIN },
  inLanguage: 'en',
};

export interface ArticleInput {
  title: string;
  description: string;
  slug: string;
  datePublished: string;
  dateModified: string;
  tag: string;
  wordCount?: number;
  image?: string;
}

export function buildArticleSchema(input: ArticleInput) {
  const url = blogPostUrl(input.slug);
  const image = input.image ?? `${SITE_ORIGIN}/og-default.png`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: clamp(input.title, 110),
    description: clamp(input.description, 160),
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: {
      '@type': 'Person',
      name: AUTHOR_NAME,
      url: AUTHOR_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: ORG_NAME,
      logo: { '@type': 'ImageObject', url: ORG_LOGO },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    image,
    articleSection: input.tag,
    inLanguage: 'en',
    ...(typeof input.wordCount === 'number' ? { wordCount: input.wordCount } : {}),
  };
}

export function buildFaqSchema(faq: Array<{ q: string; a: string }>) {
  if (!faq || faq.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: stripHtml(item.q),
      acceptedAnswer: {
        '@type': 'Answer',
        text: stripHtml(item.a),
      },
    })),
  };
}

export function safeBuild<T>(fn: () => T, label: string): T | null {
  try {
    return fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[schema] ${label} build failed: ${msg}`);
    return null;
  }
}

export function countWords(html: string): number {
  return stripHtml(html).split(/\s+/).filter(Boolean).length;
}

export const SITE_ORIGIN = 'https://rivett.tech';

export function buildCanonicalUrl(pathname: string): string {
  if (pathname.startsWith('http')) return pathname;
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const stripped = path === '/' ? '/' : path.replace(/\/+$/, '');
  return `${SITE_ORIGIN}${stripped}`;
}

export function blogPostUrl(slug: string): string {
  return buildCanonicalUrl(`/blog/${slug}`);
}

import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { blogPostUrl, SITE_ORIGIN } from '../utils/canonicalUrl';

export async function GET(_context: APIContext) {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );

  const slugFor = (p: { data: { slug?: string }; id: string }) =>
    p.data.slug ?? p.id.replace(/\.md$/, '');

  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

  const sections: string[] = [];
  sections.push('# Rivett Field Notes - Full Corpus');
  sections.push('');
  sections.push(
    'Senior growth practice for profitable US operators. Diagnose revenue leaks,',
  );
  sections.push(
    'rebuild the system between demand and revenue, ship AI-assisted pipelines.',
  );
  sections.push(`Source: ${SITE_ORIGIN} | Generated: ${new Date().toISOString().slice(0, 10)}`);
  sections.push('');
  sections.push('---');
  sections.push('');

  for (const post of posts) {
    const slug = slugFor(post);
    const url = blogPostUrl(slug);
    sections.push(`# ${post.data.title}`);
    sections.push('');
    sections.push(`> ${post.data.excerpt}`);
    sections.push('');
    sections.push(`URL: ${url} | Published: ${fmtDate(post.data.date)} | Tag: ${post.data.tag} | Author: Fred Style`);
    sections.push('');
    sections.push((post.body ?? '').trim());
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  return new Response(sections.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { blogPostUrl, SITE_ORIGIN } from '../utils/canonicalUrl';

export async function GET(_context: APIContext) {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );

  const slugFor = (p: { data: { slug?: string }; id: string }) =>
    p.data.slug ?? p.id.replace(/\.md$/, '');

  const lines: string[] = [];
  lines.push('# Rivett');
  lines.push('');
  lines.push(
    '> Senior growth practice for profitable US operators. Diagnose revenue leaks,',
  );
  lines.push(
    '> rebuild the system between demand and revenue, ship AI-assisted pipelines.',
  );
  lines.push(`> Founder: Fred Style. Site: ${SITE_ORIGIN}`);
  lines.push('');
  lines.push('## Field Notes');
  lines.push('');

  for (const post of posts) {
    const slug = slugFor(post);
    const url = blogPostUrl(slug);
    lines.push(`- [${post.data.title}](${url}): ${post.data.excerpt}`);
  }

  lines.push('');
  lines.push('## Tools');
  lines.push('');
  lines.push(`- [Revenue Leak MRI](${SITE_ORIGIN}/revenue-leak-mri): interactive diagnostic for finding broken revenue mechanics.`);
  lines.push(`- [Book a diagnostic](${SITE_ORIGIN}/diagnostic): two-week fixed-scope engagement, one senior operator, one-page memo. No payment up front.`);
  lines.push('');
  lines.push('## Full corpus');
  lines.push('');
  lines.push(`- [llms-full.txt](${SITE_ORIGIN}/llms-full.txt): full markdown of every Field Note in one file.`);
  lines.push(`- [Per-post markdown](${SITE_ORIGIN}/blog/{slug}.md): raw markdown for any post.`);
  lines.push(`- [RSS](${SITE_ORIGIN}/rss.xml): full-content RSS feed.`);
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

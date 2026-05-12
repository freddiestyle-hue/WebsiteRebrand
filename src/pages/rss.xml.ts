import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { marked } from 'marked';

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );

  return rss({
    title: 'Rivett · Field Notes',
    description:
      "Notes from the desk. Working ideas about pipelines that hold, agents that ship, and the operator math that decides whether either is worth doing.",
    site: context.site!,
    items: posts.map(p => {
      const slug = p.data.slug ?? p.id.replace(/\.md$/, '');
      const body = (p.body ?? '').trim();
      let content = '';
      try {
        content = marked.parse(body, { async: false }) as string;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[rss] markdown render failed for ${slug}: ${msg}`);
      }
      return {
        title: p.data.title,
        pubDate: p.data.date,
        description: p.data.excerpt,
        link: `/blog/${slug}`,
        categories: [p.data.tag],
        author: 'Fred Style',
        content,
      };
    }),
    customData: '<language>en-gb</language>',
    xmlns: { content: 'http://purl.org/rss/1.0/modules/content/' },
  });
}

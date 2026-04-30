import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

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
      return {
        title: p.data.title,
        pubDate: p.data.date,
        description: p.data.excerpt,
        link: `/blog/${slug}`,
        categories: [p.data.tag],
      };
    }),
    customData: '<language>en-gb</language>',
  });
}

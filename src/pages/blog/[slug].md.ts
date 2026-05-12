import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { blogPostUrl } from '../../utils/canonicalUrl';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map((post) => ({
    params: { slug: post.data.slug ?? post.id.replace(/\.md$/, '') },
    props: { post },
  }));
}

export async function GET(context: APIContext) {
  const post = context.props.post as {
    data: {
      title: string;
      date: Date;
      tag: string;
      excerpt: string;
      metaDescription?: string;
      readTime: number;
      slug?: string;
    };
    body?: string;
    id: string;
  };

  const slug = post.data.slug ?? post.id.replace(/\.md$/, '');
  const url = blogPostUrl(slug);
  const date = post.data.date.toISOString().slice(0, 10);
  const description = post.data.metaDescription ?? post.data.excerpt;

  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: "${post.data.title.replace(/"/g, '\\"')}"`);
  lines.push(`date: ${date}`);
  lines.push(`tag: ${post.data.tag}`);
  lines.push(`author: Fred Style`);
  lines.push(`canonical: ${url}`);
  lines.push(`description: "${description.replace(/"/g, '\\"')}"`);
  lines.push(`read_time: ${post.data.readTime}`);
  lines.push('---');
  lines.push('');
  lines.push((post.body ?? '').trim());
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

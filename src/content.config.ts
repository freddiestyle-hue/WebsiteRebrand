import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    lastModified: z.coerce.date().optional(),
    slug: z.string().optional(),
    tag: z.enum(['Strategy', 'Insights', 'Engineering', 'Company', 'Guide']),
    excerpt: z.string(),
    metaDescription: z.string().optional(),
    readTime: z.number(),
  }),
});

export const collections = { blog };

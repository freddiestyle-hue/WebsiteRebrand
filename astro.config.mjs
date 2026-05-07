// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://rivett.tech',
  trailingSlash: 'never',
  adapter: vercel(),
  integrations: [
    react(),
    sitemap({
      filter: (page) => {
        const pathname = page.startsWith('http') ? new URL(page).pathname : page;
        return !pathname.startsWith('/q/');
      },
    }),
  ],
  build: {
    format: 'directory',
  },
  markdown: {
    smartypants: false,
  },
  redirects: {
    '/contact': '/diagnostic',
    '/book': '/diagnostic',
    '/tools': '/revenue-leak-mri',
    '/tools/revenue-leak-mri': '/revenue-leak-mri',
    '/tools/brand-memory-vault': '/revenue-leak-mri',
    '/tools/agentic-marketing-os-map': '/revenue-leak-mri',
    '/field-kits': '/revenue-leak-mri',
    '/field-kits/brand-memory-vault': '/revenue-leak-mri',
    '/field-kits/agentic-marketing-os-map': '/revenue-leak-mri',
  },
});

// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://rivett.tech',
  trailingSlash: 'never',
  integrations: [sitemap()],
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

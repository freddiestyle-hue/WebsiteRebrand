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
    '/field-kits': '/tools',
    '/field-kits/brand-memory-vault': '/tools/brand-memory-vault',
    '/field-kits/agentic-marketing-os-map': '/tools/agentic-marketing-os-map',
    '/revenue-leak-mri': '/tools/revenue-leak-mri',
  },
});

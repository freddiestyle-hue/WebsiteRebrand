// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const privateSitemapPrefixes = ['/api/', '/internal/', '/q/', '/audit/p/'];

const staticSitemapRoutes = {
  '/': {
    file: 'src/pages/index.astro',
    changefreq: 'weekly',
    priority: 1,
  },
  '/blog': {
    file: 'src/pages/blog/index.astro',
    changefreq: 'weekly',
    priority: 0.8,
  },
  '/diagnostic': {
    file: 'src/pages/diagnostic.astro',
    changefreq: 'monthly',
    priority: 0.8,
  },
  '/revenue-leak-mri': {
    file: 'src/pages/revenue-leak-mri.astro',
    changefreq: 'monthly',
    priority: 0.8,
  },
};

/** @param {string | undefined} value */
function toIsoDate(value) {
  if (!value) return undefined;
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** @param {string} relativePath */
function latestGitDate(relativePath) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', relativePath], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** @param {string} relativePath */
function fileModifiedDate(relativePath) {
  try {
    return fs.statSync(path.join(rootDir, relativePath)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * @param {string} frontmatter
 * @param {string} key
 */
function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return match?.[1]?.trim();
}

function blogSitemapMeta() {
  const blogDir = path.join(rootDir, 'src/content/blog');
  const entries = new Map();

  if (!fs.existsSync(blogDir)) return entries;

  for (const filename of fs.readdirSync(blogDir)) {
    if (!filename.endsWith('.md')) continue;

    const relativePath = `src/content/blog/${filename}`;
    const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    const slug = frontmatterValue(frontmatter, 'slug') ?? filename.replace(/\.md$/, '');
    const lastmod =
      toIsoDate(frontmatterValue(frontmatter, 'lastModified')) ??
      toIsoDate(frontmatterValue(frontmatter, 'date')) ??
      latestGitDate(relativePath) ??
      fileModifiedDate(relativePath);

    entries.set(`/blog/${slug}`, {
      lastmod,
      changefreq: 'monthly',
      priority: 0.6,
    });
  }

  return entries;
}

function staticSitemapMeta() {
  return new Map(
    Object.entries(staticSitemapRoutes).map(([pathname, meta]) => [
      pathname,
      {
        changefreq: meta.changefreq,
        priority: meta.priority,
        lastmod: latestGitDate(meta.file) ?? fileModifiedDate(meta.file),
      },
    ]),
  );
}

const sitemapMeta = new Map([...staticSitemapMeta(), ...blogSitemapMeta()]);

/** @param {string} page */
function pathnameFor(page) {
  const pathname = page.startsWith('http') ? new URL(page).pathname : page;
  return pathname === '' ? '/' : pathname;
}

/** @param {string} page */
function isPublicIndexablePath(page) {
  const pathname = pathnameFor(page);
  return !privateSitemapPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export default defineConfig({
  site: 'https://rivett.tech',
  trailingSlash: 'never',
  // PageSpeed Insights API in /audit/v3 takes 20-30s on slow targets.
  // Hobby tier ceiling is 60s; bump from the 10s default.
  adapter: vercel({ maxDuration: 60 }),
  integrations: [
    react(),
    sitemap({
      filter: isPublicIndexablePath,
      serialize: (item) => {
        if (!isPublicIndexablePath(item.url)) return undefined;

        const pathname = pathnameFor(item.url);
        const meta = sitemapMeta.get(pathname);

        return {
          ...item,
          ...meta,
        };
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

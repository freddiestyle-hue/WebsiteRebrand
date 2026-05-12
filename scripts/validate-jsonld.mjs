#!/usr/bin/env node
// Build-gate: walks dist/blog/*/index.html, extracts JSON-LD, validates
// required Article + FAQPage fields. Fails the build if anything is broken.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

async function resolveDistRoot() {
  for (const candidate of ['dist/client', 'dist']) {
    const path = join(projectRoot, candidate);
    try {
      await stat(join(path, 'blog'));
      return path;
    } catch {}
  }
  return null;
}

const distRoot = await resolveDistRoot();
if (!distRoot) {
  console.error('[validate-jsonld] could not find dist/blog or dist/client/blog. Did the build run?');
  process.exit(1);
}
const blogRoot = join(distRoot, 'blog');

const SCRIPT_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

const REQUIRED_ARTICLE_FIELDS = [
  '@context',
  '@type',
  'headline',
  'datePublished',
  'dateModified',
  'author',
  'publisher',
  'mainEntityOfPage',
  'url',
];

const errors = [];
const warnings = [];

function extractAll(html) {
  const blocks = [];
  let match;
  SCRIPT_RE.lastIndex = 0;
  while ((match = SCRIPT_RE.exec(html)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function decodeForJson(raw) {
  return raw.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>');
}

async function checkPost(dir, slug) {
  const file = join(dir, 'index.html');
  let html;
  try {
    html = await readFile(file, 'utf8');
  } catch {
    return;
  }
  const blocks = extractAll(html);
  if (blocks.length === 0) {
    errors.push(`[${slug}] no JSON-LD blocks found`);
    return;
  }
  let articleSeen = false;
  let faqSeen = false;
  for (let i = 0; i < blocks.length; i++) {
    const raw = decodeForJson(blocks[i]);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      errors.push(`[${slug}] block ${i} not valid JSON: ${err.message}`);
      continue;
    }
    const type = parsed['@type'];
    if (type === 'Article' || type === 'BlogPosting') {
      articleSeen = true;
      for (const field of REQUIRED_ARTICLE_FIELDS) {
        if (!(field in parsed)) {
          errors.push(`[${slug}] Article missing required field: ${field}`);
        }
      }
      if (!parsed.author?.name) errors.push(`[${slug}] Article author.name missing`);
      if (!parsed.publisher?.name) errors.push(`[${slug}] Article publisher.name missing`);
      if (parsed.mainEntityOfPage?.['@id'] !== parsed.url) {
        warnings.push(`[${slug}] mainEntityOfPage.@id and url disagree`);
      }
    }
    if (type === 'FAQPage') {
      faqSeen = true;
      if (!Array.isArray(parsed.mainEntity) || parsed.mainEntity.length === 0) {
        errors.push(`[${slug}] FAQPage has empty mainEntity`);
      } else {
        for (const q of parsed.mainEntity) {
          if (!q.name) errors.push(`[${slug}] FAQPage question missing name`);
          if (!q.acceptedAnswer?.text) errors.push(`[${slug}] FAQPage answer.text missing`);
        }
      }
    }
  }
  if (!articleSeen) errors.push(`[${slug}] no Article schema found`);
  if (!faqSeen) warnings.push(`[${slug}] no FAQPage schema (post may legitimately lack FAQ)`);
}

async function listDirs(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function main() {
  console.log(`[validate-jsonld] using ${distRoot}`);

  const slugs = await listDirs(blogRoot);
  for (const slug of slugs) {
    if (slug === 'index.html') continue;
    await checkPost(join(blogRoot, slug), slug);
  }

  // Spot check homepage has Organization + WebSite
  try {
    const homeHtml = await readFile(join(distRoot, 'index.html'), 'utf8');
    const homeBlocks = extractAll(homeHtml).map((b) => {
      try {
        return JSON.parse(decodeForJson(b));
      } catch {
        return null;
      }
    });
    const types = homeBlocks.filter(Boolean).map((b) => b['@type']);
    if (!types.includes('Organization')) errors.push('[homepage] missing Organization schema');
    if (!types.includes('WebSite')) errors.push('[homepage] missing WebSite schema');
  } catch {
    warnings.push('[homepage] index.html missing (skipping homepage schema check)');
  }

  // llms.txt + llms-full.txt presence
  for (const file of ['llms.txt', 'llms-full.txt']) {
    try {
      const stats = await stat(join(distRoot, file));
      if (stats.size < 200) errors.push(`[${file}] suspiciously small (${stats.size} bytes)`);
    } catch {
      errors.push(`[${file}] missing from build output`);
    }
  }

  console.log(`[validate-jsonld] checked ${slugs.length} blog posts`);
  for (const w of warnings) console.warn(`WARN ${w}`);
  if (errors.length) {
    console.error(`\n[validate-jsonld] FAILED with ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`[validate-jsonld] OK (${warnings.length} warning(s))`);
}

main().catch((err) => {
  console.error('[validate-jsonld] crashed:', err);
  process.exit(1);
});

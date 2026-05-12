import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));

export function latestGitDate(relativePath: string): string | undefined {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relativePath], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function fileModifiedDate(relativePath: string): string | undefined {
  try {
    return fs.statSync(path.join(rootDir, relativePath)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

export function toIsoDate(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function resolveDates(post: {
  id: string;
  data: { date: Date; lastModified?: Date };
}): { datePublished: string; dateModified: string } {
  const relativePath = `src/content/blog/${post.id.endsWith('.md') ? post.id : `${post.id}.md`}`;
  const datePublished = toIsoDate(post.data.date) ?? new Date().toISOString();
  const dateModified =
    toIsoDate(post.data.lastModified) ??
    latestGitDate(relativePath) ??
    fileModifiedDate(relativePath) ??
    datePublished;
  return { datePublished, dateModified };
}

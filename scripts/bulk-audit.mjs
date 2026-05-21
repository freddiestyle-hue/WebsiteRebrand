#!/usr/bin/env node
// Bulk-runs /audit/v3 against a list of domains and writes a summary CSV
// with the cached audit URL per row. The hero (page lede, DM one-liner,
// strength, source) is fetched per row from the hero endpoint.
//
// Usage:
//   node scripts/bulk-audit.mjs <input.csv> [output.csv]
//   node scripts/bulk-audit.mjs <input.csv> --concurrency 3 --base https://rivett.tech
//
// Input CSV must have a `domain` column (case-insensitive). Other columns
// are passed through verbatim if present (company, score, etc).
//
// Output CSV columns:
//   domain, company, http_status, success, audit_url, slug, score,
//   hero_source, hero_dimension, hero_one_liner, hero_strength, hero_page,
//   attempts, duration_ms, error
//
// Behavior:
// - Concurrency 3 by default (matches the design doc / Vercel function limits).
// - One retry per domain on 5xx / network errors. KV silent failures are
//   detected by GET-ing /audit/v3/{slug} and checking for 404. If 404 after
//   POST 200, we retry the POST once.
// - 90s per-request timeout (Vercel function timeout is 60s but proxy adds buffer).

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const DEFAULT_BASE = 'https://rivett.tech';
const DEFAULT_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 90_000;
const RETRY_BACKOFF_MS = 5_000;

function parseArgs(args) {
  const positional = [];
  const opts = { concurrency: DEFAULT_CONCURRENCY, base: DEFAULT_BASE };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--concurrency') opts.concurrency = parseInt(args[++i], 10);
    else if (a === '--base') opts.base = args[++i];
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    } else positional.push(a);
  }
  if (positional.length < 1) {
    console.error('Usage: node scripts/bulk-audit.mjs <input.csv> [output.csv]');
    exit(2);
  }
  opts.input = positional[0];
  opts.output = positional[1] ?? positional[0].replace(/\.csv$/, '') + '_audit_summary.csv';
  return opts;
}

// Minimal CSV reader. Handles quoted fields with embedded commas / quotes.
// Returns { header: string[], rows: Record<string,string>[] }.
function parseCsv(text) {
  const lines = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.length > 1 || row[0] !== '') lines.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    lines.push(row);
  }
  const header = lines[0] ?? [];
  const rows = lines.slice(1).map((cols) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = cols[idx] ?? '';
    });
    return obj;
  });
  return { header, rows };
}

// Minimal CSV writer. Quotes fields that contain commas, quotes, or newlines.
function writeCsv(header, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const out = [header.join(',')];
  for (const r of rows) out.push(header.map((h) => esc(r[h])).join(','));
  return out.join('\n') + '\n';
}

// Same shape as src/utils/audit/slug.ts:v3SlugFromDomain.
function v3SlugFromDomain(input) {
  let raw = String(input).trim().toLowerCase();
  if (!raw) throw new Error('Empty domain');
  raw = raw.replace(/^https?:\/\//, '').replace(/^www\./, '');
  raw = raw.split('/')[0].split(':')[0].split('?')[0].replace(/\.+$/, '');
  if (!raw.includes('.')) throw new Error(`Domain missing TLD: ${input}`);
  return raw.replace(/\./g, '-');
}

async function withTimeout(promise, ms, signalSetter) {
  const ac = new AbortController();
  if (signalSetter) signalSetter(ac.signal);
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await promise(ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Vercel firewall returns 403 on POSTs without a real browser UA + Origin +
// Referer triplet. Sending what a logged-in operator's browser would send.
const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

async function postAudit(base, domain) {
  const body = new URLSearchParams({ url: domain });
  const res = await withTimeout(
    (signal) =>
      fetch(`${base}/audit/v3`, {
        method: 'POST',
        headers: {
          ...BROWSER_HEADERS,
          'content-type': 'application/x-www-form-urlencoded',
          origin: base,
          referer: `${base}/audit/v3`,
        },
        body,
        signal,
        redirect: 'manual',
      }),
    REQUEST_TIMEOUT_MS,
  );
  return { status: res.status, ok: res.ok };
}

async function verifySlugCached(base, slug) {
  try {
    const res = await withTimeout(
      (signal) =>
        fetch(`${base}/audit/v3/${slug}`, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          signal,
          redirect: 'manual',
        }),
      30_000,
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

async function fetchHero(base, slug) {
  try {
    const res = await withTimeout(
      (signal) =>
        fetch(`${base}/api/audit/v3/hero/${slug}`, {
          method: 'GET',
          headers: { ...BROWSER_HEADERS, accept: 'application/json' },
          signal,
        }),
      30_000,
    );
    if (res.status !== 200) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function auditOne(base, domain, company) {
  const startedAt = Date.now();
  let slug;
  try {
    slug = v3SlugFromDomain(domain);
  } catch (e) {
    return {
      domain,
      company,
      http_status: '',
      success: 'false',
      audit_url: '',
      slug: '',
      attempts: '0',
      duration_ms: String(Date.now() - startedAt),
      error: `slug: ${e.message}`,
      score: '',
      hero_source: '',
      hero_dimension: '',
      hero_one_liner: '',
      hero_strength: '',
      hero_page: '',
    };
  }

  let lastStatus = 0;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { status } = await postAudit(base, domain);
      lastStatus = status;
      if (status >= 200 && status < 400) {
        // Verify the slug landed in KV (drunk-checkpoint flagged silent KV failures).
        const cached = await verifySlugCached(base, slug);
        if (cached) {
          const hero = await fetchHero(base, slug);
          return {
            domain,
            company,
            http_status: String(status),
            success: 'true',
            audit_url: `${base}/audit/v3/${slug}`,
            slug,
            attempts: String(attempt),
            duration_ms: String(Date.now() - startedAt),
            error: '',
            score: hero?.score != null ? String(hero.score) : '',
            hero_source: hero?.source ?? '',
            hero_dimension: hero?.fallbackDimension ?? '',
            hero_one_liner: hero?.hero?.dmOneLiner ?? '',
            hero_strength: hero?.hero?.strength ?? '',
            hero_page: hero?.hero?.pageHero ?? '',
          };
        }
        lastError = 'kv_silent_failure';
      } else {
        lastError = `http_${status}`;
      }
    } catch (e) {
      lastError = e.name === 'AbortError' ? 'timeout' : e.message;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
  }

  return {
    domain,
    company,
    http_status: String(lastStatus),
    success: 'false',
    audit_url: '',
    slug,
    attempts: '2',
    duration_ms: String(Date.now() - startedAt),
    error: lastError,
    score: '',
    hero_source: '',
    hero_dimension: '',
    hero_one_liner: '',
    hero_strength: '',
    hero_page: '',
  };
}

async function runPool(items, concurrency, worker, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function tick() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done++;
      onProgress?.(done, items.length, results[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, tick));
  return results;
}

function fmtRow(r) {
  const dur = (parseInt(r.duration_ms, 10) / 1000).toFixed(1);
  const flag = r.success === 'true' ? 'OK ' : 'FAIL';
  return `[${flag}] ${r.domain.padEnd(40)} ${dur.padStart(5)}s  ${r.error || r.audit_url}`;
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  const raw = await readFile(opts.input, 'utf8');
  const { header, rows } = parseCsv(raw);
  const domainCol = header.find((h) => h.toLowerCase() === 'domain');
  if (!domainCol) {
    console.error('Input CSV missing `domain` column. Found:', header.join(', '));
    exit(2);
  }
  const companyCol = header.find((h) => h.toLowerCase() === 'company');

  let queue = rows
    .map((r) => ({ domain: (r[domainCol] || '').trim(), company: companyCol ? (r[companyCol] || '').trim() : '' }))
    .filter((r) => r.domain);
  if (opts.limit) queue = queue.slice(0, opts.limit);

  console.error(
    `Auditing ${queue.length} domains against ${opts.base} with concurrency ${opts.concurrency}.`,
  );
  if (opts.dryRun) {
    console.error('Dry-run: not making any requests.');
    queue.forEach((q) => console.error(`  - ${q.domain} (${q.company})`));
    return;
  }

  const t0 = Date.now();
  const results = await runPool(queue, opts.concurrency, ({ domain, company }) =>
    auditOne(opts.base, domain, company),
  (done, total, last) => {
    console.error(`(${done}/${total}) ${fmtRow(last)}`);
  });

  const okCount = results.filter((r) => r.success === 'true').length;
  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.error(`\nDone: ${okCount}/${results.length} ok in ${elapsed} min.`);

  const outHeader = [
    'domain', 'company', 'http_status', 'success', 'audit_url',
    'slug', 'score', 'hero_source', 'hero_dimension', 'hero_one_liner',
    'hero_strength', 'hero_page', 'attempts', 'duration_ms', 'error',
  ];
  await writeFile(opts.output, writeCsv(outHeader, results), 'utf8');
  console.error(`Wrote ${opts.output}`);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});

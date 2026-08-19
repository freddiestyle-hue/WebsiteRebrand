#!/usr/bin/env node
// Bulk-runs /audit/v3 against a list of domains and writes a summary CSV with
// the cached audit URL, hero, and hero eval verdict per row.
//
// Usage:
//   node scripts/bulk-audit.mjs <input.csv> [output.csv]
//   node scripts/bulk-audit.mjs <input.csv> --concurrency 3 --base https://rivett.tech
//   node scripts/bulk-audit.mjs <input.csv> --max-cost 150
//   node scripts/bulk-audit.mjs <input.csv> --skip-cached
//   node scripts/bulk-audit.mjs <input.csv> --no-resume
//
// Input CSV must have a `domain` column (case-insensitive). A `company`
// column is carried through if present. A `person` or `first_name` column
// is POSTed as firstName so the memo can greet the prospect.
//
// Crash-safety:
// - The output CSV is rewritten atomically (temp file + rename) after every
//   completed prospect, so a crash or Ctrl-C never loses finished work.
// - Resume is automatic: on start, domains already marked success in the
//   existing output file are skipped. Re-run the same command to continue.
//   Failed rows from a prior run are retried. Pass --no-resume to ignore the
//   existing output and run every domain fresh.
//
// Cost:
// - Each freshly-run audit is estimated at EST_COST_PER_FRESH_AUDIT for a
//   running tally. --max-cost <usd> stops dispatching new work once the
//   estimate crosses the ceiling; in-flight prospects still finish.
// - --skip-cached checks KV before POSTing and skips the scan when the audit
//   is already cached. OFF by default: it would skip stale pre-deploy audits,
//   so do NOT use it for a post-deploy regeneration batch.
//
// Behavior:
// - Concurrency 1 by default. Each audit spawns headless Chrome inside the
//   Vercel function, and the platform throttles parallel headless invocations
//   at the edge (5xx before the function runs). At concurrency 1, success rate
//   is ~95%+ first pass; at concurrency 3, dropped to ~40-60% on the 2026-05-27
//   batch. Override with --concurrency N if you have lighter-weight audits or
//   are running against a different backend that handles concurrent headless.
// - One retry per domain on 5xx / network errors. KV silent failures are
//   detected by GET-ing /audit/v3/{slug} and checking for a non-200.
// - Aborts if the first MAX_CONSECUTIVE_FAILURES prospects fail back to back
//   (endpoint down or misconfigured); results so far are saved, exit code 1.
// - 240s per-request timeout (matches the v3.astro maxDuration of 300s
//   with headroom for network round-trip).

import { readFile, writeFile, rename } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'https://rivett.tech';
const DEFAULT_CONCURRENCY = 1;
const REQUEST_TIMEOUT_MS = 240_000;
const RETRY_BACKOFF_MS = 5_000;

// Conservative per-prospect cost ceiling for a freshly-run audit: a headless
// scan, PageSpeed Insights, and one Claude Sonnet hero call. Drives the
// --max-cost kill-switch and the cost line in the summary - it is a guardrail
// estimate, not an invoice. Cached/resumed prospects count as $0. Tune if the
// real per-audit cost is known.
const EST_COST_PER_FRESH_AUDIT = 0.5;

// Abort if this many prospects fail back to back. A streak this long means the
// endpoint is down or the run is misconfigured (wrong --base, auth), not a
// transient blip - better to stop and let the operator fix it than burn hours
// hammering a dead endpoint. Resume picks up from where it stopped.
const MAX_CONSECUTIVE_FAILURES = 15;

// Fixed output columns. Adding columns is safe for the downstream Python
// scripts (they read by name); never rename or drop one.
const OUT_HEADER = [
  'domain', 'company', 'http_status', 'success', 'audit_url', 'slug', 'score',
  'hero_source', 'hero_dimension', 'hero_one_liner', 'hero_strength', 'hero_page',
  'hero_eval_pass', 'hero_eval_failures', 'audit_cached',
  'attempts', 'audit_ms', 'hero_ms', 'duration_ms', 'error',
];

function parseArgs(args) {
  const positional = [];
  const opts = {
    concurrency: DEFAULT_CONCURRENCY,
    base: DEFAULT_BASE,
    resume: true,
    skipCached: false,
    maxCost: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--concurrency') opts.concurrency = parseInt(args[++i], 10);
    else if (a === '--base') opts.base = args[++i];
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10);
    else if (a === '--max-cost') opts.maxCost = parseFloat(args[++i]);
    else if (a === '--skip-cached') opts.skipCached = true;
    else if (a === '--no-resume') opts.resume = false;
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
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1) {
    console.error('--concurrency must be a positive integer');
    exit(2);
  }
  if (opts.maxCost != null && (!Number.isFinite(opts.maxCost) || opts.maxCost <= 0)) {
    console.error('--max-cost must be a positive number');
    exit(2);
  }
  opts.input = positional[0];
  opts.output = positional[1] ?? positional[0].replace(/\.csv$/, '') + '_audit_summary.csv';
  return opts;
}

// Minimal CSV reader. Handles quoted fields with embedded commas / quotes.
// Returns { header: string[], rows: Record<string,string>[] }.
export function parseCsv(text) {
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
export function writeCsv(header, rows) {
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

// Domains that already succeeded in a prior run - the resume skip-set. Failed
// rows are deliberately excluded so a re-run retries them.
export function successfulDomains(rows) {
  const done = new Set();
  for (const r of rows) {
    if (r && r.domain && r.success === 'true') done.add(r.domain);
  }
  return done;
}

// Final output rows in input order: a fresh row from this run wins over a
// carried-over prior row; a domain with neither is omitted (it gets picked up
// on the next resume). Duplicate input domains collapse to one row.
export function mergeOutputRows(orderedDomains, priorByDomain, freshByDomain) {
  const out = [];
  const seen = new Set();
  for (const d of orderedDomains) {
    if (seen.has(d)) continue;
    seen.add(d);
    const row = freshByDomain.get(d) ?? priorByDomain.get(d);
    if (row) out.push(row);
  }
  return out;
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

async function postAudit(base, domain, firstName) {
  const body = new URLSearchParams({ url: domain });
  if (firstName) body.set('firstName', firstName);
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

function emptyRow(domain, company) {
  return {
    domain,
    company,
    http_status: '',
    success: 'false',
    audit_url: '',
    slug: '',
    score: '',
    hero_source: '',
    hero_dimension: '',
    hero_one_liner: '',
    hero_strength: '',
    hero_page: '',
    hero_eval_pass: '',
    hero_eval_failures: '',
    audit_cached: '',
    attempts: '0',
    audit_ms: '',
    hero_ms: '',
    duration_ms: '0',
    error: '',
  };
}

// Audit one prospect. Returns { row, fresh } - `fresh` is true when this call
// triggered a fresh audit POST (it counts toward the cost estimate); it is
// false for a --skip-cached hit.
async function auditOne(base, domain, company, opts) {
  const firstName = opts.firstName || '';
  const startedAt = Date.now();
  const row = emptyRow(domain, company);

  let slug;
  try {
    slug = v3SlugFromDomain(domain);
  } catch (e) {
    row.error = `slug: ${e.message}`;
    row.duration_ms = String(Date.now() - startedAt);
    return { row, fresh: false };
  }
  row.slug = slug;

  let fresh = true;
  let auditOk = false;
  let lastStatus = 0;
  let lastError = '';
  const auditStart = Date.now();

  if (opts.skipCached && (await verifySlugCached(base, slug))) {
    // Audit already in KV - skip the expensive POST.
    fresh = false;
    auditOk = true;
    row.audit_cached = 'true';
    row.http_status = '200';
    row.attempts = '0';
  } else {
    for (let attempt = 1; attempt <= 2; attempt++) {
      row.attempts = String(attempt);
      try {
        const { status } = await postAudit(base, domain, firstName);
        lastStatus = status;
        if (status >= 200 && status < 400) {
          // Verify the slug landed in KV (silent KV failures happen).
          if (await verifySlugCached(base, slug)) {
            auditOk = true;
            row.http_status = String(status);
            break;
          }
          lastError = 'kv_silent_failure';
        } else {
          lastError = `http_${status}`;
        }
      } catch (e) {
        lastError = e.name === 'AbortError' ? 'timeout' : e.message;
      }
      // Vercel's gateway returns 504 at 60s, but the audit function keeps
      // running and writes to KV ~30-90s later. Always verify the cache
      // before declaring failure - we may have a successful audit even when
      // the POST appeared to error out.
      if (!auditOk && await verifySlugCached(base, slug)) {
        auditOk = true;
        row.http_status = lastStatus ? String(lastStatus) : '504';
        lastError = '';
        break;
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  row.audit_ms = String(Date.now() - auditStart);

  if (!auditOk) {
    row.http_status = String(lastStatus);
    row.error = lastError;
    row.duration_ms = String(Date.now() - startedAt);
    return { row, fresh };
  }

  // Audit is in KV; fetch the hero (the endpoint generates it on a miss).
  const heroStart = Date.now();
  const hero = await fetchHero(base, slug);
  row.hero_ms = String(Date.now() - heroStart);

  if (!hero) {
    // The audit succeeded but the hero round trip failed - leave success
    // false so the resume retries it rather than shipping a blank hero.
    row.error = 'hero_fetch_failed';
    row.duration_ms = String(Date.now() - startedAt);
    return { row, fresh };
  }

  row.success = 'true';
  row.audit_url = `${base}/audit/v3/${slug}`;
  row.score = hero.score != null ? String(hero.score) : '';
  row.hero_source = hero.source ?? '';
  row.hero_dimension = hero.fallbackDimension ?? '';
  row.hero_one_liner = hero.hero?.dmOneLiner ?? '';
  row.hero_strength = hero.hero?.strength ?? '';
  row.hero_page = hero.hero?.pageHero ?? '';
  if (hero.evaluation) {
    row.hero_eval_pass = String(hero.evaluation.pass);
    row.hero_eval_failures = Array.isArray(hero.evaluation.failures)
      ? hero.evaluation.failures.join('; ')
      : '';
  }
  row.duration_ms = String(Date.now() - startedAt);
  return { row, fresh };
}

// Worker pool. Pulls items until exhausted or a stop is signalled. onResult
// runs once per completion and returns true to stop dispatching new work;
// in-flight workers still drain.
async function runPool(items, concurrency, worker, onResult) {
  let next = 0;
  let stopped = false;
  async function tick() {
    while (!stopped) {
      const i = next++;
      if (i >= items.length) return;
      const result = await worker(items[i], i);
      if (onResult(result, i)) stopped = true;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, tick));
}

async function readCsvIfExists(path) {
  try {
    const text = await readFile(path, 'utf8');
    return parseCsv(text).rows;
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
}

// Write the CSV to a temp file then rename over the target. rename is atomic
// on the same filesystem, so a crash mid-write never leaves a partial file.
async function atomicWriteCsv(path, header, rows) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, writeCsv(header, rows), 'utf8');
  await rename(tmp, path);
}

function fmtRow(row, estCost) {
  const dur = (parseInt(row.duration_ms, 10) / 1000).toFixed(1);
  const flag = row.success === 'true' ? 'OK  ' : 'FAIL';
  const cost = `$${estCost.toFixed(2)}`;
  return `[${flag}] ${row.domain.padEnd(38)} ${dur.padStart(5)}s ${cost.padStart(8)}  ${
    row.error || row.audit_url
  }`;
}

function tally(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function fmtTally(entries) {
  return entries.map(([k, n]) => `${n} ${k}`).join(' | ');
}

function printSummary({ orderedDomains, todoCount, freshByDomain, priorByDomain, estCost, freshCount, t0, stopReason, output }) {
  const all = mergeOutputRows(orderedDomains, priorByDomain, freshByDomain);
  const ok = all.filter((r) => r.success === 'true');
  const failed = all.filter((r) => r.success !== 'true');
  const evalRows = ok.filter((r) => r.hero_eval_pass !== '' && r.hero_eval_pass != null);
  const evalPass = evalRows.filter((r) => r.hero_eval_pass === 'true').length;
  const processed = freshByDomain.size;
  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);

  console.error('\n=== Batch summary ===');
  if (stopReason) console.error(`STOPPED EARLY: ${stopReason}`);
  console.error(
    `Prospects:   ${all.length} in output | ${processed} processed this run | ` +
      `${all.length - processed} carried from a prior run`,
  );
  console.error(
    `Result:      ${ok.length} ok (${all.length ? ((ok.length / all.length) * 100).toFixed(1) : '0'}%) | ${failed.length} failed`,
  );
  if (failed.length) console.error(`Failures:    ${fmtTally(tally(failed.map((r) => r.error || 'unknown')))}`);
  if (ok.length) console.error(`Hero source: ${fmtTally(tally(ok.map((r) => r.hero_source || 'none')))}`);
  if (evalRows.length) console.error(`Hero eval:   ${evalPass}/${evalRows.length} pass`);
  console.error(
    `Est. cost:   ~$${estCost.toFixed(2)} this run (${freshCount} fresh audits @ ~$${EST_COST_PER_FRESH_AUDIT.toFixed(2)})`,
  );
  console.error(`Wall time:   ${elapsed} min`);
  console.error(`Output:      ${output}`);
  if (processed < todoCount) {
    console.error(`Remaining:   ${todoCount - processed} not reached - re-run the same command to resume.`);
  }
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
  const firstNameCol = header.find((h) => {
    const k = String(h).toLowerCase().replace(/\s+/g, '_');
    return k === 'first_name' || k === 'firstname' || k === 'person';
  });

  let queue = rows
    .map((r) => ({
      domain: (r[domainCol] || '').trim(),
      company: companyCol ? (r[companyCol] || '').trim() : '',
      firstName: firstNameCol ? (r[firstNameCol] || '').trim() : '',
    }))
    .filter((r) => r.domain);
  if (opts.limit) queue = queue.slice(0, opts.limit);
  const orderedDomains = queue.map((q) => q.domain);

  // Resume: carry prior rows, skip domains already marked success.
  const priorByDomain = new Map();
  if (opts.resume) {
    for (const r of await readCsvIfExists(opts.output)) {
      if (r.domain) priorByDomain.set(r.domain, r);
    }
  }
  const done = successfulDomains([...priorByDomain.values()]);
  const todo = queue.filter((q) => !done.has(q.domain));

  console.error(`Auditing ${queue.length} domains against ${opts.base} (concurrency ${opts.concurrency}).`);
  if (done.size > 0) {
    console.error(`Resuming: ${done.size} already done in ${opts.output}, ${todo.length} to go.`);
  }
  console.error(
    `Estimated cost if all run fresh: ~$${(todo.length * EST_COST_PER_FRESH_AUDIT).toFixed(2)} ` +
      (opts.maxCost != null ? `(ceiling --max-cost $${opts.maxCost.toFixed(2)})` : '(no --max-cost ceiling set)'),
  );
  if (opts.skipCached) {
    console.error('--skip-cached on: cached audits are reused. Do not use this for a post-deploy regeneration.');
  }

  if (opts.dryRun) {
    console.error('Dry-run: not making any requests.');
    todo.forEach((q) => console.error(`  - ${q.domain} (${q.company})`));
    return;
  }
  if (todo.length === 0) {
    console.error('Nothing to do - every domain is already complete. Use --no-resume to run them again.');
    return;
  }

  const t0 = Date.now();
  const freshByDomain = new Map();
  let estCost = 0;
  let freshCount = 0;
  let consecutiveFails = 0;
  let completed = 0;
  let stopReason = null;

  // Atomic, serialized output write. Chaining keeps concurrent completions
  // from interleaving a write; each persist reflects the latest results.
  let writeTail = Promise.resolve();
  const persist = () => {
    writeTail = writeTail.then(() =>
      atomicWriteCsv(opts.output, OUT_HEADER, mergeOutputRows(orderedDomains, priorByDomain, freshByDomain)),
    );
  };

  await runPool(
    todo,
    opts.concurrency,
    ({ domain, company, firstName }) => auditOne(opts.base, domain, company, { ...opts, firstName }),
    ({ row, fresh }) => {
      completed++;
      freshByDomain.set(row.domain, row);
      if (fresh) {
        estCost += EST_COST_PER_FRESH_AUDIT;
        freshCount++;
      }
      consecutiveFails = row.success === 'true' ? 0 : consecutiveFails + 1;
      persist();
      console.error(`(${completed}/${todo.length}) ${fmtRow(row, estCost)}`);
      if (opts.maxCost != null && estCost >= opts.maxCost) {
        stopReason = `cost ceiling $${opts.maxCost.toFixed(2)} reached (est. $${estCost.toFixed(2)})`;
        return true;
      }
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILURES) {
        stopReason = `${consecutiveFails} consecutive failures - endpoint likely down or misconfigured`;
        return true;
      }
      return false;
    },
  );

  await writeTail;
  await atomicWriteCsv(opts.output, OUT_HEADER, mergeOutputRows(orderedDomains, priorByDomain, freshByDomain));

  printSummary({
    orderedDomains,
    todoCount: todo.length,
    freshByDomain,
    priorByDomain,
    estCost,
    freshCount,
    t0,
    stopReason,
    output: opts.output,
  });

  if (stopReason && stopReason.includes('consecutive failures')) exit(1);
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    exit(1);
  });
}

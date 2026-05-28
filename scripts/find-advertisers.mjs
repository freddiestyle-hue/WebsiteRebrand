#!/usr/bin/env node
// Scans a prospect CSV for advertisers using ScrapeCreators. Queries the
// three ad libraries (Meta, Google, LinkedIn) per domain and outputs a CSV
// flagging which ones have active ads. Way cheaper than running the full
// /audit/v3 pipeline because it skips PSI, headless, synth, etc.
//
// Output columns: domain, company, meta_ads, google_ads, linkedin_ads,
// total_ads, has_ads, sample_landing
//
// Usage:
//   node scripts/find-advertisers.mjs <input.csv> [output.csv]
//   node scripts/find-advertisers.mjs <input.csv> --concurrency 5 --limit 50

import { readFile, writeFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { existsSync } from 'node:fs';

const DEFAULT_CONCURRENCY = 5;
const SC_BASE = 'https://api.scrapecreators.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;

function parseArgs(args) {
  const positional = [];
  const opts = { concurrency: DEFAULT_CONCURRENCY };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--concurrency') opts.concurrency = parseInt(args[++i], 10);
    else if (a === '--limit') opts.limit = parseInt(args[++i], 10);
    else if (a === '--skip') opts.skip = parseInt(args[++i], 10);
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      exit(2);
    } else positional.push(a);
  }
  if (positional.length < 1) {
    console.error('Usage: node scripts/find-advertisers.mjs <input.csv> [output.csv]');
    exit(2);
  }
  opts.input = positional[0];
  opts.output = positional[1] ?? positional[0].replace(/\.csv$/, '') + '_advertisers.csv';
  return opts;
}

function parseCsv(text) {
  const lines = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') lines.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); lines.push(row); }
  const header = lines[0] ?? [];
  return {
    header,
    rows: lines.slice(1).map((cols) => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = cols[idx] ?? ''; });
      return obj;
    }),
  };
}

function writeCsv(header, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))].join('\n') + '\n';
}

function companyFromHostname(hostname) {
  return hostname.replace(/^www\./, '').split('.')[0];
}

// Returns { ok: true, body } or { ok: false, error, message }. ScrapeCreators
// can return HTTP 200 with `success: false` (e.g. "out of credits"), which we
// must NOT treat as a real zero - that bug burned a full prospect scan run.
async function safeJson(url, apiKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'x-api-key': apiKey }, signal: ctrl.signal });
    if (!res.ok) {
      const error = res.status === 401 || res.status === 403 ? 'auth' : 'transport';
      return { ok: false, error, message: `HTTP ${res.status}` };
    }
    const body = await res.json();
    if (body && typeof body === 'object' && body.success === false) {
      const msg = typeof body.message === 'string' ? body.message : 'success:false';
      const error = /credit/i.test(msg) ? 'credits' : 'unknown';
      return { ok: false, error, message: msg };
    }
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: 'transport', message: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function countAds(resp) {
  if (!resp.ok) return null;
  const json = resp.body;
  if (!json) return 0;
  // Prefer the API's own total over array length: each endpoint caps the
  // returned array at one page (Google=40, Meta=30, LinkedIn=24), so
  // counting array length silently truncates anyone running more than a page.
  if (typeof json.number_of_ads_estimate === 'number') return json.number_of_ads_estimate;
  if (typeof json.searchResultsCount === 'number') return json.searchResultsCount;
  if (typeof json.totalAds === 'number') return json.totalAds;
  if (Array.isArray(json.results)) return json.results.length;
  if (Array.isArray(json.ads)) return json.ads.length;
  return 0;
}

function extractLandingPages(resp) {
  if (!resp.ok) return [];
  const json = resp.body;
  const out = new Set();
  const items = json?.results ?? json?.ads ?? [];
  for (const item of items) {
    const lp = item?.snapshot?.link_url ?? item?.snapshotUrl ?? item?.landing_url;
    if (lp) out.add(lp);
    if (out.size >= 3) break;
  }
  return [...out];
}

function fmtCount(n) {
  return n == null ? 'ERR' : String(n);
}

async function checkOne(domain, company, apiKey) {
  const meta = `${SC_BASE}/facebook/adLibrary/company/ads?companyName=${encodeURIComponent(company)}&country=US&status=ACTIVE&trim=true`;
  const google = `${SC_BASE}/google/company/ads?domain=${encodeURIComponent(domain)}&region=US`;
  const linkedin = `${SC_BASE}/linkedin/ads/search?company=${encodeURIComponent(company)}&countries=US`;

  const [metaResp, googleResp, linkedinResp] = await Promise.all([
    safeJson(meta, apiKey),
    safeJson(google, apiKey),
    safeJson(linkedin, apiKey),
  ]);

  const metaAds = countAds(metaResp);
  const googleAds = countAds(googleResp);
  const linkedinAds = countAds(linkedinResp);
  const allErrored = metaAds === null && googleAds === null && linkedinAds === null;
  const anyAds = (metaAds ?? 0) + (googleAds ?? 0) + (linkedinAds ?? 0);
  const sampleLanding = extractLandingPages(metaResp).slice(0, 2).join(' | ');

  // Collect error messages so the operator can see WHY a row is unknown.
  const errors = [];
  for (const [name, r] of [['meta', metaResp], ['google', googleResp], ['linkedin', linkedinResp]]) {
    if (!r.ok) errors.push(`${name}:${r.error}`);
  }

  return {
    domain,
    company,
    meta_ads: fmtCount(metaAds),
    google_ads: fmtCount(googleAds),
    linkedin_ads: fmtCount(linkedinAds),
    total_ads: String(anyAds),
    has_ads: allErrored ? 'unknown' : anyAds > 0 ? 'true' : 'false',
    sample_landing: sampleLanding,
    errors: errors.join(';'),
  };
}

async function runPool(items, concurrency, worker, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  let abort = false;
  let abortReason = '';
  async function tick() {
    while (true) {
      if (abort) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { domain: items[i].domain, company: items[i].company || '', meta_ads: '', google_ads: '', linkedin_ads: '', total_ads: '', has_ads: 'error', sample_landing: '', errors: e.message };
      }
      done++;
      onProgress?.(done, items.length, results[i]);
      // Bail early if credits are exhausted - every further call is wasted.
      if (results[i].errors && /credits/.test(results[i].errors) && results[i].has_ads === 'unknown') {
        abort = true;
        abortReason = 'ScrapeCreators credits exhausted - aborting scan.';
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, tick));
  if (abort) console.error(`\n!!! ${abortReason}`);
  return results;
}

async function main() {
  const opts = parseArgs(argv.slice(2));

  // Load API key from .env.local
  const envPath = './.env.local';
  if (existsSync(envPath)) {
    const env = await readFile(envPath, 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_]+)="?(.+?)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) {
    console.error('SCRAPECREATORS_API_KEY missing. Run `vercel env pull` first.');
    exit(2);
  }

  const raw = await readFile(opts.input, 'utf8');
  const { header, rows } = parseCsv(raw);
  const domainCol = header.find((h) => h.toLowerCase() === 'domain');
  const companyCol = header.find((h) => h.toLowerCase() === 'company');
  if (!domainCol) { console.error('Input CSV missing `domain` column.'); exit(2); }

  let queue = rows.map((r) => ({
    domain: (r[domainCol] || '').trim(),
    company: companyCol ? (r[companyCol] || '').trim() : '',
  })).filter((r) => r.domain);

  if (opts.skip) queue = queue.slice(opts.skip);
  if (opts.limit) queue = queue.slice(0, opts.limit);

  console.error(`Scanning ${queue.length} domains for advertisers (concurrency ${opts.concurrency}).`);
  console.error(`Est. ${queue.length * 3} ScrapeCreators credits. Output: ${opts.output}`);

  const t0 = Date.now();
  const results = await runPool(queue, opts.concurrency, ({ domain, company }) =>
    checkOne(domain, company || companyFromHostname(domain), apiKey),
  (done, total, r) => {
    const flag = r.has_ads === 'true' ? '*ADS*' : r.has_ads === 'unknown' ? ' ??? ' : '     ';
    if (r.has_ads === 'true' || r.has_ads === 'unknown' || done % 25 === 0 || done === total) {
      console.error(`(${String(done).padStart(4)}/${total}) ${flag} ${r.domain.padEnd(40)} M:${r.meta_ads.padStart(3)} G:${r.google_ads.padStart(3)} L:${r.linkedin_ads.padStart(3)} ${r.errors || ''}`);
    }
  });

  const advCount = results.filter((r) => r.has_ads === 'true').length;
  const errCount = results.filter((r) => r.has_ads === 'error' || r.has_ads === 'unknown').length;
  const noAdsCount = results.filter((r) => r.has_ads === 'false').length;
  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.error(`\nDone in ${elapsed} min: ${advCount} advertisers, ${noAdsCount} no ads, ${errCount} unknown/error.`);
  if (errCount > 0) {
    const sample = results.find((r) => r.errors && (r.has_ads === 'unknown' || r.has_ads === 'error'));
    if (sample?.errors) console.error(`Sample error: ${sample.errors} - investigate before trusting the "no ads" tally.`);
  }

  const outHeader = ['domain', 'company', 'meta_ads', 'google_ads', 'linkedin_ads', 'total_ads', 'has_ads', 'sample_landing', 'errors'];
  await writeFile(opts.output, writeCsv(outHeader, results), 'utf8');
  console.error(`Wrote ${opts.output}`);
}

main().catch((e) => { console.error(e); exit(1); });

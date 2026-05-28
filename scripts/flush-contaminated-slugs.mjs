#!/usr/bin/env node
// One-shot remediation for the 10 batch-379 rows where the LLM hero claimed
// Meta or LinkedIn ad activity that the audit could not actually measure.
//
// Removes audit-v3:{slug} and audit-v3-hero:{slug} from Upstash so the next
// fetch triggers a fresh scan + fresh hero generation under the post-fix
// grounding rule.
//
// Usage:
//   node scripts/flush-contaminated-slugs.mjs
//   node scripts/flush-contaminated-slugs.mjs --dry-run

import { readFileSync } from 'node:fs';
import { Redis } from '@upstash/redis';

// Minimal .env.local loader - dotenv isn't a project dep, and pulling one in
// for a one-shot remediation script isn't worth the bookkeeping.
function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync('.env.local', 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const SLUGS = process.env.FLUSH_SLUGS
  ? process.env.FLUSH_SLUGS.split(',').map((s) => s.trim()).filter(Boolean)
  : [
      'peopledriven-com',
      'studiog-studio',
      'vitrazza-com',
      'intellistarsaba-com',
      'paradigmlife-net',
      'linkedin-com',
      'workshopapd-com',
      'populistcleaning-com',
      'simplecitizen-com',
      'orthoscan-com',
      'vertafore-com',
    ];

const dryRun = process.argv.includes('--dry-run');

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error('Missing KV_REST_API_URL or KV_REST_API_TOKEN in .env.local');
  process.exit(1);
}

const redis = new Redis({ url, token });

console.log(`${dryRun ? '[dry-run] ' : ''}Flushing ${SLUGS.length} slugs from Upstash`);

let flushed = 0;
let missing = 0;
for (const slug of SLUGS) {
  const memoKey = `audit-v3:${slug}`;
  const heroKey = `audit-v3-hero:${slug}`;

  const [memoExists, heroExists] = await Promise.all([redis.exists(memoKey), redis.exists(heroKey)]);

  if (dryRun) {
    console.log(`  ${slug.padEnd(28)} memo=${memoExists ? 'YES' : 'no'}  hero=${heroExists ? 'YES' : 'no'}`);
    continue;
  }

  const [memoDel, heroDel] = await Promise.all([redis.del(memoKey), redis.del(heroKey)]);
  if (memoDel || heroDel) {
    flushed++;
    console.log(`  ${slug.padEnd(28)} memo=${memoDel ? 'deleted' : 'missing'}  hero=${heroDel ? 'deleted' : 'missing'}`);
  } else {
    missing++;
    console.log(`  ${slug.padEnd(28)} both keys already absent`);
  }
}

if (!dryRun) {
  console.log(`\nDone: ${flushed} slugs flushed, ${missing} had no cached entries.`);
}

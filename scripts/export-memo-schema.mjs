#!/usr/bin/env node
// Emit artifacts/memo-schema.json from the Zod schema (single source of truth).
//
// Usage: node scripts/export-memo-schema.mjs

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const { memoToJsonSchema, MEMO_SCHEMA_VERSION } = await import(
  resolve(repoRoot, 'src/utils/audit/memo-schema.ts')
);

const jsonSchema = memoToJsonSchema();
const outPath = resolve(repoRoot, 'artifacts/memo-schema.json');
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
console.log(`wrote ${outPath} · MEMO_SCHEMA_VERSION=${MEMO_SCHEMA_VERSION}`);

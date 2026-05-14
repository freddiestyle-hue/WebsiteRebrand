import { z } from 'zod';

export const MEMO_SCHEMA_VERSION = '2.0.0';

const CoverSchema = z.object({
  kicker: z.string().min(1),
  roman: z.string().min(1),
  italic: z.string().optional(),
  dek: z.string().optional(),
});

// 6-cell verdict grid: synthesis layer Codex emits directly.
// Icon names match the SVG sprite IDs (#ic-search, #ic-bolt, etc).
export const VERDICT_ICON_VALUES = [
  'search',
  'bolt',
  'target',
  'megaphone',
  'bar',
  'spark',
  'mail',
  'phone',
  'flag',
  'eye',
  'clock',
] as const;

const VerdictCheckSchema = z.object({
  ok: z.boolean(),
  text: z.string().min(1),
});

const VerdictCellSchema = z.object({
  icon: z.enum(VERDICT_ICON_VALUES),
  heading: z.string().min(1),
  value: z.string().min(1),
  note: z.string().min(1),
  // Old single-string benchmark stays for back-compat with /audit/p memos
  // written under the v2.0.0 schema. New v3 audits split it into two columns
  // for the cell footer: bench-left (method/category) and bench-right (status).
  benchmark: z.string().nullish(),
  benchmarkRight: z.string().nullish(),
  checks: z.array(VerdictCheckSchema).default([]),
});

const RankedFixSchema = z.object({
  rank: z.number().int().min(1).max(10),
  what: z.string().min(1),
  why: z.string().min(1),
  effort: z.enum(['low', 'med', 'high']),
  impact: z.enum(['low', 'med', 'high']),
});

export const BenchmarkSchema = z.object({
  industryName: z.string().min(1),
  industryN: z.number().int().min(2),
  scoreNumeric: z.number(),
  industryMedian: z.number(),
  industryP25: z.number().optional(),
  industryP75: z.number().optional(),
  percentile: z.number().min(0).max(100).optional(),
  betterThanCount: z.number().int().min(0).optional(),
  worseThanCount: z.number().int().min(0).optional(),
  scoreMax: z.number().optional(),
  snapshotDate: z.string().datetime().optional(),
  oneLiner: z.string().optional(),
});

export const ScreenshotsSchema = z.object({
  homepageDesktop: z.url().optional(),
  homepageMobile: z.url().optional(),
  capturedAt: z.string().datetime().optional(),
  source: z.string().optional(),
});

export const MemoSchema = z.object({
  version: z.literal(MEMO_SCHEMA_VERSION),
  slug: z.string().regex(/^[a-z0-9-]+-[a-z0-9]{16}$/, {
    message: 'Slug must match {normalized-domain}-{16-char-random}',
  }),
  domain: z.string().min(1),
  // All optional top-level metadata: use .nullish() because Python's
  // json.dumps(None) emits literal `null`. .optional() would only accept
  // missing keys or undefined, and a memo with `"industry": null` would
  // fail validation and 500 the route.
  companyName: z.string().nullish(),
  industry: z.string().nullish(),
  employees: z.union([z.string(), z.number()]).nullish(),
  state: z.string().nullish(),
  city: z.string().nullish(),
  generatedAt: z.string().datetime(),

  cover: CoverSchema,
  benchmark: BenchmarkSchema.optional(),
  screenshots: ScreenshotsSchema.optional(),

  verdictCells: z.array(VerdictCellSchema).min(3).max(10),
  rankedFixes: z.array(RankedFixSchema).min(1).max(5),

  personalObservation: z.object({
    text: z.string().min(1),
  }),
});

export type Memo = z.infer<typeof MemoSchema>;
export type MemoCover = z.infer<typeof CoverSchema>;
export type VerdictCell = z.infer<typeof VerdictCellSchema>;
export type VerdictCheck = z.infer<typeof VerdictCheckSchema>;
export type VerdictIcon = (typeof VERDICT_ICON_VALUES)[number];
export type RankedFix = z.infer<typeof RankedFixSchema>;
export type Benchmark = z.infer<typeof BenchmarkSchema>;
export type Screenshots = z.infer<typeof ScreenshotsSchema>;

export function fmtInt(n?: number): string | null {
  if (n == null) return null;
  return n.toLocaleString('en-US');
}

export function memoToJsonSchema() {
  return z.toJSONSchema(MemoSchema);
}

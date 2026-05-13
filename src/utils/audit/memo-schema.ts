import { z } from 'zod';

export const MEMO_SCHEMA_VERSION = '1.0.0';

export const SEVERITY_VALUES = ['critical', 'material', 'minor', 'fix', 'keep'] as const;

const FindingSchema = z.object({
  idx: z.string().optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  severityLabel: z.string().optional(),
  heading: z.string().min(1),
  italic: z.string().optional(),
  paragraphs: z.array(z.string().min(1)).default([]),
});

const SectionSchema = z.object({
  num: z.string().optional(),
  heading: z.string().min(1),
  italic: z.string().optional(),
  dek: z.string().optional(),
  bodyParagraphs: z.array(z.string().min(1)).default([]),
  findings: z.array(FindingSchema).default([]),
  grade: z.enum(['A', 'B', 'C', 'D', 'F', 'N/A']).optional(),
  passed: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
});

const CoverSchema = z.object({
  kicker: z.string().min(1),
  roman: z.string().min(1),
  italic: z.string().optional(),
  dek: z.string().optional(),
});

// --- T1.2 — Competitor benchmark
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

// --- T2.3 — PageSpeed / Core Web Vitals
const PageSpeedMetricsSchema = z.object({
  lcpMs: z.number().optional(),
  inpMs: z.number().optional(),
  cls: z.number().optional(),
  fcpMs: z.number().optional(),
  ttfbMs: z.number().optional(),
  performanceScore: z.number().min(0).max(100).optional(),
  band: z.enum(['poor', 'needs-improvement', 'good']).optional(),
  source: z.string().optional(),
  measuredAt: z.string().datetime().optional(),
});

export const PerformanceSchema = z.object({
  mobile: PageSpeedMetricsSchema.optional(),
  desktop: PageSpeedMetricsSchema.optional(),
  commentary: z.string().optional(),
});

// --- T2.4 — Screenshots
export const ScreenshotsSchema = z.object({
  homepageDesktop: z.url().optional(),
  homepageMobile: z.url().optional(),
  capturedAt: z.string().datetime().optional(),
  source: z.string().optional(),
});

// --- T1.1 — Ad landing pages
export const AdLandingPageSchema = z.object({
  url: z.url(),
  platform: z.enum(['meta', 'google', 'linkedin', 'tiktok', 'youtube', 'other']).optional(),
  adsActive: z.number().int().min(0).optional(),
  firstSeen: z.string().optional(),
  screenshotDesktop: z.url().optional(),
  screenshotMobile: z.url().optional(),
  trackingFindings: z.array(z.string()).default([]),
  conversionFindings: z.array(z.string()).default([]),
  aeoFindings: z.array(z.string()).default([]),
  driftFromHomepage: z.string().optional(),
  commentary: z.string().optional(),
});

// --- T2.5 — Organic traffic
const KeywordRankingSchema = z.object({
  keyword: z.string().min(1),
  position: z.number().int().min(1),
  monthlyVolume: z.number().int().min(0).optional(),
  url: z.string().optional(),
});

export const OrganicTrafficSchema = z.object({
  estimatedMonthlyVisits: z.number().int().min(0).optional(),
  topKeywords: z.array(KeywordRankingSchema).default([]),
  estimatedMonthlyValueUsd: z.number().optional(),
  source: z.string().optional(),
  snapshotDate: z.string().optional(),
  commentary: z.string().optional(),
});

// --- T3.6 — Mobile rendering
// All fields accept null because Python emits null for missing values.
export const MobileRenderingSchema = z.object({
  viewport: z.string().nullish(),
  screenshot: z.string().nullish(),
  hasHorizontalScroll: z.boolean().nullish(),
  smallestTapTargetPx: z.number().nullish(),
  textTooSmall: z.boolean().nullish(),
  commentary: z.string().nullish(),
});

// --- T3.7 — Email deliverability
export const EmailDeliverabilitySchema = z.object({
  spfPresent: z.boolean().nullish(),
  spfPolicy: z.string().nullish(),
  dmarcPresent: z.boolean().nullish(),
  dmarcPolicy: z.string().nullish(),
  dkimPresent: z.boolean().nullish(),
  mxPresent: z.boolean().nullish(),
  mxProvider: z.string().nullish(),
  commentary: z.string().nullish(),
});

// --- T3.8 — AI engine citation check (v4 placeholder)
const AiCitationProbeSchema = z.object({
  engine: z.enum(['claude', 'openai', 'perplexity', 'gemini', 'other']),
  query: z.string().min(1),
  cited: z.boolean(),
  citationContext: z.string().optional(),
  competitorsCited: z.array(z.string()).default([]),
  responseExcerpt: z.string().optional(),
  probedAt: z.string().datetime().optional(),
});

export const AiCitationSchema = z.object({
  probes: z.array(AiCitationProbeSchema).default([]),
  summary: z.string().optional(),
});

// --- Root memo schema
export const MemoSchema = z.object({
  version: z.literal(MEMO_SCHEMA_VERSION),
  slug: z.string().regex(/^[a-z0-9-]+-[a-z0-9]{16}$/, {
    message: 'Slug must match {normalized-domain}-{16-char-random}',
  }),
  domain: z.string().min(1),
  // All optional top-level metadata: use .nullish() because Python's
  // json.dumps(None) emits literal `null`. .optional() would only accept
  // missing keys or undefined, and a memo with `"industry": null` would
  // fail validation and 500 the route. Hit during E2E smoke 2026-05-13.
  companyName: z.string().nullish(),
  industry: z.string().nullish(),
  employees: z.union([z.string(), z.number()]).nullish(),
  state: z.string().nullish(),
  city: z.string().nullish(),
  generatedAt: z.string().datetime(),

  cover: CoverSchema,

  aeo: SectionSchema,
  tracking: SectionSchema,
  conversion: SectionSchema,
  adActivity: SectionSchema,

  personalObservation: z.object({
    text: z.string().min(1),
  }),

  scoreNumeric: z.number().nullish(),
  scoreMax: z.number().nullish(),
  scorePercent: z.number().min(0).max(100).nullish(),
  band: z.enum(['invisible', 'weak', 'discoverable', 'ready']).nullish(),

  // Optional T1 / T2 / T3 expansions
  benchmark: BenchmarkSchema.optional(),
  performance: PerformanceSchema.optional(),
  screenshots: ScreenshotsSchema.optional(),
  adLandingPages: z.array(AdLandingPageSchema).default([]),
  organicTraffic: OrganicTrafficSchema.optional(),
  mobileRendering: MobileRenderingSchema.optional(),
  emailDeliverability: EmailDeliverabilitySchema.optional(),
  aiCitation: AiCitationSchema.optional(),
});

export type Memo = z.infer<typeof MemoSchema>;
export type MemoSection = z.infer<typeof SectionSchema>;
export type MemoFinding = z.infer<typeof FindingSchema>;
export type MemoCover = z.infer<typeof CoverSchema>;
export type Benchmark = z.infer<typeof BenchmarkSchema>;
export type Performance = z.infer<typeof PerformanceSchema>;
export type Screenshots = z.infer<typeof ScreenshotsSchema>;
export type AdLandingPage = z.infer<typeof AdLandingPageSchema>;
export type OrganicTraffic = z.infer<typeof OrganicTrafficSchema>;
export type MobileRendering = z.infer<typeof MobileRenderingSchema>;
export type EmailDeliverability = z.infer<typeof EmailDeliverabilitySchema>;
export type AiCitation = z.infer<typeof AiCitationSchema>;

const SEVERITY_TO_CLASS: Record<string, string> = {
  critical: 'sev bad',
  material: 'sev warn',
  minor: 'sev',
  fix: 'sev sev--neutral',
  keep: 'sev',
};

export function severityClass(severity?: string): string {
  if (!severity) return 'sev';
  return SEVERITY_TO_CLASS[severity] ?? 'sev';
}

export function fmtMs(ms?: number): string | null {
  if (ms == null) return null;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function fmtInt(n?: number): string | null {
  if (n == null) return null;
  return n.toLocaleString('en-US');
}

export function memoToJsonSchema() {
  return z.toJSONSchema(MemoSchema);
}

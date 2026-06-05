import { z } from 'zod';

export const MEMO_SCHEMA_VERSION = '2.0.0';
export const BRITE_MEMO_SCHEMA_VERSION = '3.0.0';
export const SUPPORTED_MEMO_SCHEMA_VERSIONS = [
  MEMO_SCHEMA_VERSION,
  BRITE_MEMO_SCHEMA_VERSION,
] as const;

// Upgrade 11 - the audit engine version that produced this memo. Bumped on
// each shipped engine change (3.5.0 ships SerpAPI pages-indexed). Surfaces
// in the memo so PostHog cohort filters can split 3.4 vs 3.5.x audit data
// post-ship. Separate from MEMO_SCHEMA_VERSION which tracks the JSON shape.
export const AUDIT_ENGINE_VERSION = '3.5.0';

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

// Upgrade 7 - reliability calibration. Mirrors ReliabilityTag in engine.ts.
//   verified     - assertable as fact
//   soft-absence - an absence the method can false-negative; never assert it
//   inferred     - a perception or model read, not a measurement
//   verified-na  - verified as not applicable to this business/channel
export const RELIABILITY_VALUES = ['verified', 'soft-absence', 'inferred', 'verified-na'] as const;

const VerdictCheckSchema = z.object({
  ok: z.boolean(),
  text: z.string().min(1),
  // Upgrade 7 - how far this row can be trusted. Optional for back-compat
  // with v2.0.0 memos written before the reliability pass existed.
  reliability: z.enum(RELIABILITY_VALUES).optional(),
  // Upgrade 8 - the check's score weight. Used by rollupReliability to
  // exclude weight-0 channel-specific signals (LinkedIn Insight, TikTok
  // Pixel, PostHog) from the soft-absence cascade so a site that doesn't
  // run those ad channels isn't tagged Unconfirmed for trackers it never
  // used. Optional for back-compat with cached memos and enrichment cells
  // (speed/mail/ads/stack) that build VerdictCheck without going through
  // CheckResult. Missing weight defaults to 1 (load-bearing) at read time.
  weight: z.number().optional(),
});

const VerdictCellSchema = z.object({
  icon: z.enum(VERDICT_ICON_VALUES),
  heading: z.string().min(1),
  value: z.string().min(1),
  note: z.string().min(1),
  // Brite v3: optional role id this gap maps to. Optional so cached v2
  // Rivett memos continue to validate unchanged.
  role: z.string().optional(),
  // Old single-string benchmark stays for back-compat with /audit/p memos
  // written under the v2.0.0 schema. New v3 audits split it into two columns
  // for the cell footer: bench-left (method/category) and bench-right (status).
  benchmark: z.string().nullish(),
  benchmarkRight: z.string().nullish(),
  checks: z.array(VerdictCheckSchema).default([]),
  // Upgrade 7 - the cell's overall trust, rolled up from its checks. A cell
  // is only as assertable as its softest load-bearing finding.
  reliability: z.enum(RELIABILITY_VALUES).optional(),
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

// Upgrade 7 - the cross-dimension synthesis the LLM hero reads as its brief.
// Rule-based and deterministic: it correlates dimensions and rolls up the
// reliability calibration, so the hero writes prose from an honest, already-
// connected read instead of guessing the diagnosis itself.
const CrossSignalSchema = z.object({
  // Stable key the page and hero branch on, e.g. 'ads-running-slow-landing'.
  key: z.string().min(1),
  // Human-readable correlation, written for the hero to turn into prose.
  detail: z.string().min(1),
  reliability: z.enum(RELIABILITY_VALUES),
});

const PaidLandingSchema = z.object({
  rawUrl: z.string().min(1),
  source: z.enum(['meta', 'google', 'linkedin']),
  confidence: z.enum(['verified', 'fuzzy']),
  pageName: z.string().nullable(),
  headline: z.string().nullable(),
  finalUrl: z.string().nullish(),
});

export const PaidEvidenceSchema = z.object({
  landings: z.array(PaidLandingSchema).default([]),
  metaActive: z.number().nullable().optional(),
  googleActive: z.number().nullable().optional(),
  linkedinActive: z.number().nullable().optional(),
  earliestSeen: z.string().nullable().optional(),
  commentary: z.string().optional(),
});

export const BriteRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  does: z.string().min(1),
  priceMonthly: z.number().nonnegative(),
  usEquivAnnual: z.number().positive().optional(),
});

export const MemoGradeSchema = z.object({
  letter: z.string().min(1),
  band: z.enum(['strong', 'solid', 'gaps', 'at-risk']),
  peerLabel: z.string().min(1),
});

const TeamGapSpecialistSchema = z.object({
  role: z.string().min(1),
  present: z.boolean(),
  who: z.string().nullish(),
});

export const TeamGapSchema = z.object({
  headcount: z.number().int().min(0).nullable(),
  specialists: z.array(TeamGapSpecialistSchema),
  missing: z.array(z.string().min(1)),
  reliability: z.enum(RELIABILITY_VALUES),
});

export const SynthesisSchema = z.object({
  // The dimension the rules flag as the systemic headline. null when nothing
  // dominates (a site clean enough that no single issue leads).
  primaryIssue: z
    .object({
      icon: z.enum(VERDICT_ICON_VALUES),
      dimension: z.string().min(1),
      summary: z.string().min(1),
      reliability: z.enum(RELIABILITY_VALUES),
    })
    .nullable(),
  // Deterministic cross-dimension correlations, in priority order.
  crossSignals: z.array(CrossSignalSchema).default([]),
  // Calibration totals - how much of the read is hard fact versus soft.
  verifiedCount: z.number().int().min(0),
  softCount: z.number().int().min(0),
});

export const MemoSchema = z.object({
  version: z.enum(SUPPORTED_MEMO_SCHEMA_VERSIONS),
  brand: z.enum(['rivett', 'brite']).default('rivett'),
  ctaUrl: z.url().optional(),
  grade: MemoGradeSchema.optional(),
  roles: z.array(BriteRoleSchema).optional(),
  teamGap: TeamGapSchema.optional(),
  // Upgrade 11 - the audit engine version that produced this memo. Optional
  // for back-compat with cached memos written before 3.5 (treated as legacy
  // /3.4 by analytics). New memos always carry it via buildMemoFromAudit.
  auditVersion: z.string().optional(),
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
  // Upgrade 7 - the cross-dimension synthesis. Optional for back-compat with
  // v2.0.0 memos written before the synthesis layer existed.
  synthesis: SynthesisSchema.optional(),
  paidEvidence: PaidEvidenceSchema.optional(),

  verdictCells: z.array(VerdictCellSchema).min(3).max(10),
  rankedFixes: z.array(RankedFixSchema).min(1).max(5),

  personalObservation: z.object({
    text: z.string().min(1),
  }),
}).superRefine((memo, ctx) => {
  if (memo.brand !== 'brite') return;

  if (!memo.roles?.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Brite memos require a non-empty roles catalog.',
      path: ['roles'],
    });
    return;
  }

  const roleIds = new Set(memo.roles.map((role) => role.id));

  memo.verdictCells.forEach((cell, index) => {
    if (!cell.role) {
      ctx.addIssue({
        code: 'custom',
        message: 'Brite verdict cells require a role id.',
        path: ['verdictCells', index, 'role'],
      });
    } else if (!roleIds.has(cell.role)) {
      ctx.addIssue({
        code: 'custom',
        message: `Brite verdict cell role '${cell.role}' is not in roles.`,
        path: ['verdictCells', index, 'role'],
      });
    }
  });

  memo.teamGap?.missing.forEach((roleId, index) => {
    if (!roleIds.has(roleId)) {
      ctx.addIssue({
        code: 'custom',
        message: `Brite teamGap missing role '${roleId}' is not in roles.`,
        path: ['teamGap', 'missing', index],
      });
    }
  });

  memo.teamGap?.specialists.forEach((specialist, index) => {
    if (!roleIds.has(specialist.role)) {
      ctx.addIssue({
        code: 'custom',
        message: `Brite teamGap specialist role '${specialist.role}' is not in roles.`,
        path: ['teamGap', 'specialists', index, 'role'],
      });
    }
  });
});

export type Memo = z.infer<typeof MemoSchema>;
export type MemoCover = z.infer<typeof CoverSchema>;
export type VerdictCell = z.infer<typeof VerdictCellSchema>;
export type VerdictCheck = z.infer<typeof VerdictCheckSchema>;
export type VerdictIcon = (typeof VERDICT_ICON_VALUES)[number];
export type Reliability = (typeof RELIABILITY_VALUES)[number];
export type RankedFix = z.infer<typeof RankedFixSchema>;
export type Benchmark = z.infer<typeof BenchmarkSchema>;
export type Screenshots = z.infer<typeof ScreenshotsSchema>;
export type Synthesis = z.infer<typeof SynthesisSchema>;
export type CrossSignal = z.infer<typeof CrossSignalSchema>;
export type PaidEvidence = z.infer<typeof PaidEvidenceSchema>;
export type BriteRole = z.infer<typeof BriteRoleSchema>;
export type MemoGrade = z.infer<typeof MemoGradeSchema>;
export type TeamGap = z.infer<typeof TeamGapSchema>;

export function fmtInt(n?: number): string | null {
  if (n == null) return null;
  return n.toLocaleString('en-US');
}

export function memoToJsonSchema() {
  return z.toJSONSchema(MemoSchema);
}

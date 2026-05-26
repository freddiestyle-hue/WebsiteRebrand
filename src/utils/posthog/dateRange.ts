// Date-range parsing and formatting for the /hq dashboard.
//
// URL schema:
//   ?range=today | 7d | 14d | 30d | 90d | all   (preset, default 14d)
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD                (explicit override)
//
// When both are present, explicit from/to wins.

export type RangePreset = 'today' | '7d' | '14d' | '30d' | '90d' | 'all' | 'custom';

export interface DateRange {
  preset: RangePreset;
  fromIso: string;
  toIso: string;
  label: string;
  days: number;
  isCustom: boolean;
}

export const PRESETS: { value: RangePreset; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 1 },
  { value: '7d', label: '7 days', days: 7 },
  { value: '14d', label: '14 days', days: 14 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: 'all', label: 'All time', days: 9999 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clamp(d: string): string {
  // Defensive: only allow YYYY-MM-DD format. Anything else falls back to today.
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : isoDate(new Date());
}

function fromDaysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d;
}

export function parseDateRange(searchParams: URLSearchParams): DateRange {
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');

  if (rawFrom && rawTo) {
    const fromDate = new Date(clamp(rawFrom) + 'T00:00:00.000Z');
    const toDate = new Date(clamp(rawTo) + 'T23:59:59.999Z');
    const days = Math.max(
      1,
      Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    return {
      preset: 'custom',
      fromIso: fromDate.toISOString(),
      toIso: toDate.toISOString(),
      label: `${clamp(rawFrom)} → ${clamp(rawTo)}`,
      days,
      isCustom: true,
    };
  }

  const preset = (searchParams.get('range') as RangePreset) || '14d';
  const def = PRESETS.find((p) => p.value === preset) || PRESETS[2];
  const now = new Date();

  if (preset === 'today') {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    return {
      preset: 'today',
      fromIso: start.toISOString(),
      toIso: now.toISOString(),
      label: 'Today',
      days: 1,
      isCustom: false,
    };
  }

  if (preset === 'all') {
    // Start from epoch (effectively unbounded).
    return {
      preset: 'all',
      fromIso: new Date('2025-01-01T00:00:00.000Z').toISOString(),
      toIso: now.toISOString(),
      label: 'All time',
      days: 9999,
      isCustom: false,
    };
  }

  const fromDate = fromDaysAgo(def.days);
  return {
    preset: def.value,
    fromIso: fromDate.toISOString(),
    toIso: now.toISOString(),
    label: def.label,
    days: def.days,
    isCustom: false,
  };
}

// HogQL-safe timestamp clause. Both bounds inclusive on the from side, exclusive
// on the to side via timestamp >= from AND timestamp <= to. ISO strings are
// safe because we built them ourselves from parsed input.
export function hogqlRangeClause(range: DateRange): string {
  return `timestamp >= toDateTime('${range.fromIso}') AND timestamp <= toDateTime('${range.toIso}')`;
}

// For padding the activity timeline: number of full days the range spans.
export function rangeDaysSpan(range: DateRange): number {
  const from = new Date(range.fromIso).getTime();
  const to = new Date(range.toIso).getTime();
  return Math.max(1, Math.ceil((to - from) / (1000 * 60 * 60 * 24)));
}

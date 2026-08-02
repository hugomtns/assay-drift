import type { AggregatedRow } from '../lapis/endpoints';
import { MIN_DENOMINATOR } from './constants';

export type Granularity = 'week' | 'month';

export interface TrendPoint {
  bucket: string;
  nFullCoverage: number;
  nMismatch: number;
  mismatchFraction: number | null;
  sufficientData: boolean;
}

export interface TrendSeries {
  granularity: Granularity;
  points: TrendPoint[];
  undatedFullCoverage: number;
  undatedMismatch: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function chooseGranularity(dateFrom: string, dateTo: string): Granularity {
  const spanDays = (Date.parse(dateTo) - Date.parse(dateFrom)) / DAY_MS;
  return spanDays > 180 ? 'month' : 'week';
}

export function bucketOf(isoDate: string, granularity: Granularity): string {
  if (granularity === 'month') return isoDate.slice(0, 7);
  const date = new Date(`${isoDate}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday
  const offsetToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(date.getTime() - offsetToMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function accumulate(
  rows: AggregatedRow[],
  dateField: string,
  granularity: Granularity,
): { buckets: Map<string, number>; undated: number } {
  const buckets = new Map<string, number>();
  let undated = 0;
  for (const row of rows) {
    const raw = row[dateField];
    if (typeof raw !== 'string' || raw === '') {
      undated += row.count;
      continue;
    }
    const bucket = bucketOf(raw, granularity);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + row.count);
  }
  return { buckets, undated };
}

export function buildTrend(input: {
  coverageRows: AggregatedRow[];
  mismatchRows: AggregatedRow[];
  dateField: string;
  dateFrom: string;
  dateTo: string;
}): TrendSeries {
  const granularity = chooseGranularity(input.dateFrom, input.dateTo);
  const coverage = accumulate(input.coverageRows, input.dateField, granularity);
  const mismatch = accumulate(input.mismatchRows, input.dateField, granularity);

  const points: TrendPoint[] = [...coverage.buckets.keys()]
    .sort()
    .map((bucket) => {
      const nFullCoverage = coverage.buckets.get(bucket) ?? 0;
      const nMismatch = mismatch.buckets.get(bucket) ?? 0;
      const sufficientData = nFullCoverage >= MIN_DENOMINATOR;
      return {
        bucket,
        nFullCoverage,
        nMismatch,
        mismatchFraction: sufficientData ? nMismatch / nFullCoverage : null,
        sufficientData,
      };
    });

  return {
    granularity,
    points,
    undatedFullCoverage: coverage.undated,
    undatedMismatch: mismatch.undated,
  };
}

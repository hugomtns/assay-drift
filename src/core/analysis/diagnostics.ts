import type { Attribution } from './attribution';
import type { WindowMetrics } from './metrics';
import type { TrendSeries } from './trend';
import {
  COVERAGE_GAP_WARN, DEPOSITION_LAG_BUCKETS, DEPOSITION_LAG_RATIO,
  MIN_DENOMINATOR, TOP_COUNTRY_SHARE_WARN,
} from './constants';

export type DiagnosticId =
  | 'no-data' | 'small-n' | 'coverage-gap'
  | 'deposition-lag' | 'geographic-concentration' | 'undated-records';

export interface Diagnostic {
  id: DiagnosticId;
  severity: 'info' | 'warn';
  message: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

export function computeDiagnostics(input: {
  metrics: WindowMetrics;
  trend: TrendSeries;
  country: Attribution;
}): Diagnostic[] {
  const { metrics, trend, country } = input;
  const out: Diagnostic[] = [];

  if (metrics.nScope === 0) {
    out.push({
      id: 'no-data', severity: 'warn',
      message: 'No sequences match these filters. Widen the date range or remove a filter.',
    });
    return out;
  }

  if (!metrics.sufficientData) {
    out.push({
      id: 'small-n', severity: 'warn',
      message: `Only ${metrics.nFullCoverage} sequences can be assessed at this site (minimum ${MIN_DENOMINATOR}). Treat any rate as indicative only.`,
    });
  }

  if (metrics.coverageGapFraction > COVERAGE_GAP_WARN) {
    out.push({
      id: 'coverage-gap', severity: 'warn',
      message: `${metrics.coverageGap} of ${metrics.nScope} sequences (${Math.round(metrics.coverageGapFraction * 100)}%) have an ambiguous base somewhere in this binding site and are excluded. A mutation there would not be visible.`,
    });
  }

  const counts = trend.points.map((p) => p.nFullCoverage);
  if (counts.length >= DEPOSITION_LAG_BUCKETS * 2) {
    const tail = counts.slice(-DEPOSITION_LAG_BUCKETS);
    const historical = median(counts.slice(0, -DEPOSITION_LAG_BUCKETS));
    if (historical > 0 && median(tail) < historical * DEPOSITION_LAG_RATIO) {
      out.push({
        id: 'deposition-lag', severity: 'warn',
        message: `The most recent ${DEPOSITION_LAG_BUCKETS} ${trend.granularity}s contain far fewer sequences than earlier periods. Sequences are usually deposited weeks after collection, so the end of the trend is incomplete rather than genuinely quiet.`,
      });
    }
  }

  if (country.topShare > TOP_COUNTRY_SHARE_WARN && country.rows.length > 0) {
    const top = country.rows[0] as { value: string; count: number };
    out.push({
      id: 'geographic-concentration', severity: 'warn',
      message: `${Math.round(country.topShare * 100)}% of the mismatch-carrying sequences come from ${top.value}. This may reflect where sequencing happens rather than where the variant circulates.`,
    });
  }

  if (trend.undatedFullCoverage > 0) {
    out.push({
      id: 'undated-records', severity: 'info',
      message: `${trend.undatedFullCoverage} assessable sequences carry no usable collection date and appear in the headline figure but not in the trend.`,
    });
  }

  return out;
}

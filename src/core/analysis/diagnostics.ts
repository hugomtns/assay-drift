import { formatCount } from '../format';
import type { Attribution } from './attribution';
import type { WindowMetrics } from './metrics';
import type { TrendSeries } from './trend';
import {
  COVERAGE_GAP_WARN, DEPOSITION_LAG_BUCKETS, DEPOSITION_LAG_RATIO,
  MIN_DENOMINATOR, TOP_COUNTRY_SHARE_WARN,
} from './constants';

export type DiagnosticId =
  | 'no-data' | 'small-n' | 'coverage-gap'
  | 'deposition-lag' | 'geographic-concentration' | 'undated-records'
  // Raised by `runAnalysis` from `guardResponseSize`, not by `computeDiagnostics`:
  // it describes the shared mutations payload, which belongs to the scope and to
  // no oligo. It is the one member of this union that is a run-level diagnostic.
  | 'large-response';

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

/**
 * No message here prints a percentage, and that is a rule rather than an
 * accident.
 *
 * `src/core/` must not import from `src/ui/`, so the only percentage available
 * to this module is a hand-rolled one -- and the hand-rolled one this file used
 * to carry, `Math.round(fraction * 100)`, rendered a real 0.4% coverage gap as
 * "0%": the word "none" in a sentence whose entire job is to report a gap.
 * That is exactly the failure `formatPercent`'s `<0.1%` rule exists to
 * prevent. Rather than reimplement that rule in a second place, these messages
 * state counts, which they already had, and leave every rate to the UI.
 *
 * `oligoName` is required, not optional, because `CaveatPanel` de-duplicates
 * diagnostics by `id` and keeps the first occurrence. Several of these are
 * properties of one *binding site*, not of the run, so with three oligos the
 * panel would otherwise quote one oligo's numbers under the words "this site"
 * with nothing on screen saying which oligo that was.
 */
export function computeDiagnostics(input: {
  /** The oligo whose site these diagnostics describe. */
  oligoName: string;
  metrics: WindowMetrics;
  trend: TrendSeries;
  country: Attribution;
}): Diagnostic[] {
  const { oligoName, metrics, trend, country } = input;
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
      // Bare, not formatted: this branch only fires below MIN_DENOMINATOR, so
      // the count is at most two digits and there is nothing to group.
      message: `Only ${metrics.nFullCoverage} sequences can be assessed at the ${oligoName} binding site (minimum ${MIN_DENOMINATOR}). Treat any rate as indicative only.`,
    });
  }

  if (metrics.coverageGapFraction > COVERAGE_GAP_WARN) {
    out.push({
      id: 'coverage-gap', severity: 'warn',
      // Deliberately carries no arithmetic. `HeadlineCard` states the gap as a
      // count and a rate, unconditionally, on the oligo's own card; this
      // sentence used to restate the same figures almost word for word one
      // screen further down, which reads as two separate findings. The card is
      // authoritative for the numbers, this is authoritative for the
      // consequence.
      message: `A large share of the sequences in scope have an ambiguous base somewhere in the ${oligoName} binding site, so they are excluded from its rate. A mutation at one of those positions would not be visible. The counts are on that oligo's card.`,
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
      message: `${formatCount(top.count)} of the ${formatCount(country.total)} sequences carrying a mismatch in the ${oligoName} binding site come from ${top.value}. This may reflect where sequencing happens rather than where the variant circulates.`,
    });
  }

  if (trend.undatedFullCoverage > 0) {
    out.push({
      id: 'undated-records', severity: 'info',
      message: `${formatCount(trend.undatedFullCoverage)} sequences assessable at the ${oligoName} binding site carry no usable collection date and appear in the headline figure but not in the trend.`,
    });
  }

  return out;
}

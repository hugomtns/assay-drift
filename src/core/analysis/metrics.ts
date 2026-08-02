import type { AggregatedRow } from '../lapis/endpoints';
import { MIN_DENOMINATOR } from './constants';

export interface WindowMetrics {
  /** Sequences matching the scope filters. */
  nScope: number;
  /** Of those, sequences with a definite call at every position of the binding site. */
  nFullCoverage: number;
  /** Of nFullCoverage, sequences carrying at least one allele the oligo cannot bind. */
  nMismatch: number;
  coverageGap: number;
  coverageGapFraction: number;
  /** nMismatch / nFullCoverage, or null when nothing is assessable. */
  mismatchFraction: number | null;
  sufficientData: boolean;
}

export function sumCounts(rows: AggregatedRow[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

export function computeWindowMetrics(input: {
  nScope: number;
  nFullCoverage: number;
  nMismatch: number;
}): WindowMetrics {
  const { nScope, nFullCoverage, nMismatch } = input;

  // These are impossible unless a query was built wrongly. Fail loudly rather
  // than printing a number that cannot be true.
  if (nFullCoverage > nScope) {
    throw new Error(`Full-coverage count ${nFullCoverage} exceeds scope count ${nScope}`);
  }
  if (nMismatch > nFullCoverage) {
    throw new Error(`Mismatch count ${nMismatch} exceeds full-coverage count ${nFullCoverage}`);
  }

  const coverageGap = nScope - nFullCoverage;
  return {
    nScope,
    nFullCoverage,
    nMismatch,
    coverageGap,
    coverageGapFraction: nScope === 0 ? 0 : coverageGap / nScope,
    mismatchFraction: nFullCoverage === 0 ? null : nMismatch / nFullCoverage,
    sufficientData: nFullCoverage >= MIN_DENOMINATOR,
  };
}

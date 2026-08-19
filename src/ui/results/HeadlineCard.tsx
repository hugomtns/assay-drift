import type { OligoAnalysis } from '../../core/analysis/run';
import type { OligoRole } from '../../core/oligo-input';
import { formatCount, formatPercent, formatRate } from '../format';

const ROLE_LABELS: Readonly<Record<OligoRole, string>> = {
  forward: 'Forward primer',
  reverse: 'Reverse primer',
  probe: 'Probe',
};

interface HeadlineCardProps {
  analysis: OligoAnalysis;
}

/**
 * One oligo's headline number.
 *
 * The percentage and the two counts it was computed from are produced by a
 * single `formatRate` call and rendered as one string inside one element --
 * `95.9% (67,520 of 70,387)`. Global Constraints 4 and 6 say a percentage
 * never appears without its absolute numbers "in the same visual unit", and
 * this is the single most quotable string in the product: it gets
 * screenshotted, pasted into a message and read aloud on its own. Two sibling
 * elements would satisfy the rule only as long as nobody rearranged them; one
 * string cannot be separated at all.
 *
 * Three states, decided here rather than inside `formatPercent`, because two
 * of them must not print a percentage *at all* — not even a hedged one:
 *
 * - `mismatchFraction === null` (nothing had full coverage): "no assessable
 *   sequences". There is no denominator, so there is no rate to hedge.
 * - `sufficientData === false` (a denominator below MIN_DENOMINATOR):
 *   "insufficient data (n = X)". The rate is computable and is deliberately
 *   not shown — at n = 30, one sequence moves the figure by 3.3 points, and a
 *   number on screen gets quoted whatever caveat sits beside it.
 * - otherwise the rate, to one decimal place.
 *
 * The null branch is tested first because both conditions hold when
 * nFullCoverage is 0, and "no assessable sequences" is the more precise of the
 * two statements.
 *
 * The coverage gap is stated unconditionally, as a count *and* a percentage of
 * scope. It is the size of the population this card is silent about, and a
 * mismatch rate over the sequences that happened to be well covered is only
 * meaningful next to it.
 */
export function HeadlineCard({ analysis }: HeadlineCardProps) {
  const { metrics } = analysis;

  const noDenominator = metrics.mismatchFraction === null;
  const rate = noDenominator
    ? 'No assessable sequences'
    : !metrics.sufficientData
      ? `Insufficient data (n = ${formatCount(metrics.nFullCoverage)})`
      : formatRate({
          fraction: metrics.mismatchFraction,
          numerator: metrics.nMismatch,
          denominator: metrics.nFullCoverage,
        });

  return (
    <>
      <span role="cell" className="min-w-0 break-words font-semibold text-slate-900">{analysis.name}</span>
      <span role="cell" className="min-w-0 break-words text-slate-600">{ROLE_LABELS[analysis.role]}</span>
      <span role="cell" className="min-w-0 break-words tabular-nums">{rate}</span>
      <span role="cell" className="min-w-0 break-words tabular-nums">
        {`Coverage gap: ${formatCount(metrics.coverageGap)} of ${formatCount(metrics.nScope)} (${formatPercent(metrics.coverageGapFraction)})`}
      </span>
    </>
  );
}

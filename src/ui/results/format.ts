/**
 * The two number formatters every results component renders through. No
 * component calls `toFixed` or `toLocaleString` on a count or a rate directly:
 * the rules below are the difference between a figure a reader can trust and
 * one that quietly lies, and they only hold if there is one implementation.
 */

/**
 * Below this fraction a rate is genuinely non-zero but rounds to `0.0%` at one
 * decimal place, so it is rendered as `<0.1%` instead. 0.001 rather than
 * 0.0005 (the true rounding boundary) so that the printed threshold and the
 * printed precision agree: everything shown as a number is at least 0.1%.
 */
const SMALLEST_REPORTABLE_FRACTION = 0.001;

/**
 * Explicit 'en-US' locale. `toLocaleString()` with no argument follows the
 * host's default, so the grouping separator would depend on the machine —
 * '67,520' on this dev box and '67.520' on a de-DE runner — and the tests
 * would pass in one place and fail in the other.
 */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * A rate as a percentage to one decimal place.
 *
 * `null` is the real type of `WindowMetrics.mismatchFraction` and
 * `TrendPoint.mismatchFraction`, and it means *we could not compute a rate* —
 * never *the rate is zero*. It is rendered in words so it can never be read as
 * a number, and so it can never be mistaken for evidence of conservation.
 *
 * A rate that is small but genuinely non-zero renders as `<0.1%`, never as
 * `0.0%`: the latter would report an observed mismatch as no mismatch at all.
 * Exactly `0` still renders `0.0%`, because that one really is zero.
 */
export function formatPercent(fraction: number | null): string {
  if (fraction === null) return 'not enough data';
  if (fraction > 0 && fraction < SMALLEST_REPORTABLE_FRACTION) return '<0.1%';
  return `${(fraction * 100).toFixed(1)}%`;
}

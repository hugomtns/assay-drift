/**
 * Re-exported from `src/core/format.ts`, which is where it has to live: the
 * analysis layer writes sentences the reader sees and cannot import from
 * `src/ui/`. Components import it from here so the import site still reads as
 * "the formatters", and so there is still exactly one implementation.
 */
import { formatCount } from '../core/format';

export { formatCount };

/**
 * The three number formatters every component renders through. No component
 * calls `toFixed` or `toLocaleString` on a count or a rate directly: the rules
 * below are the difference between a figure a reader can trust and one that
 * quietly lies, and they only hold if there is one implementation.
 *
 * This module sits at `src/ui/` rather than `src/ui/results/` because the
 * binding step formats counts too, and three private copies of
 * `toLocaleString('en-US')` had already appeared before it moved.
 */

/**
 * Below this fraction a rate is genuinely non-zero but rounds to `0.0%` at one
 * decimal place, so it is rendered as `<0.1%` instead. 0.001 rather than
 * 0.0005 (the true rounding boundary) so that the printed threshold and the
 * printed precision agree: everything shown as a number is at least 0.1%.
 */
const SMALLEST_REPORTABLE_FRACTION = 0.001;

/**
 * What a rate that could not be computed looks like. An em dash, not a word:
 * `formatRate` is the approved renderer and it always states the numbers
 * beside it, so the dash is never the whole message. Where a bare
 * `formatPercent` is the entire accessible name of something — the hidden
 * trend table is the one live case — render words instead, never this.
 */
export const NO_RATE = '—';

/**
 * A rate as a percentage to one decimal place.
 *
 * `null` is the real type of `WindowMetrics.mismatchFraction` and
 * `TrendPoint.mismatchFraction`, and it means *we could not compute a rate* —
 * never *the rate is zero*. It renders as an em dash so it can never be read
 * as a number, and so it can never be mistaken for evidence of conservation.
 *
 * A rate that is small but genuinely non-zero renders as `<0.1%`, never as
 * `0.0%`: the latter would report an observed mismatch as no mismatch at all.
 * Exactly `0` still renders `0.0%`, because that one really is zero.
 */
export function formatPercent(fraction: number | null): string {
  if (fraction === null) return NO_RATE;
  if (fraction > 0 && fraction < SMALLEST_REPORTABLE_FRACTION) return '<0.1%';
  return `${(fraction * 100).toFixed(1)}%`;
}

export interface Rate {
  fraction: number | null;
  numerator: number;
  denominator: number;
}

/**
 * The only approved way to render a rate (Global Constraint 6).
 *
 * The percentage and the two counts it was computed from come out of a single
 * call as a single string, so no layout, no copy-paste and no screenshot can
 * separate them. Every branch carries the numbers — including the hedged
 * `<0.1%` and the unavailable `—`, which are exactly the cases where a reader
 * most needs to see what the figure was computed from.
 */
export function formatRate({ fraction, numerator, denominator }: Rate): string {
  return `${formatPercent(fraction)} (${formatCount(numerator)} of ${formatCount(denominator)})`;
}

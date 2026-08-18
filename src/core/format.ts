/**
 * Number formatting shared by both layers.
 *
 * Only `formatCount` lives here. It is the one formatter with no presentation
 * decision in it — grouping digits is arithmetic, not design — and it is the
 * one both layers need: `src/core/analysis/diagnostics.ts` builds sentences a
 * reader sees, and `src/core/` may not import from `src/ui/`. Without this
 * module the caveat panel prints "67520" one line below the card's "67,520".
 *
 * `formatPercent` and `formatRate` deliberately stay in `src/ui/format.ts`.
 * They encode what the product is willing to claim — the `<0.1%` floor, the em
 * dash for an uncomputable rate, the rule that a percentage never appears
 * without its counts — and nothing in `src/core/` is allowed to render a
 * percentage at all. Keeping them out of reach is what enforces that.
 */

/**
 * Explicit 'en-US' locale. `toLocaleString()` with no argument follows the
 * host's default, so the grouping separator would depend on the machine —
 * '67,520' on this dev box and '67.520' on a de-DE runner — and the tests
 * would pass in one place and fail in the other.
 */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

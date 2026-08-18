import type { Attribution } from '../../core/analysis/attribution';
import { formatCount, formatPercent } from '../format';

interface AttributionTableProps {
  attribution: Attribution;
  label: string;
  /**
   * The oligo whose binding site these shares are about.
   *
   * Required, not optional. A results page renders two of these per oligo, so
   * with three oligos the page would otherwise carry six regions called
   * "Pango lineage" and "Country" -- a landmark list of duplicates that
   * navigates nowhere (axe `landmark-unique`, and a real dead end before it
   * is a rule). The name is part of what this table is, so a caller must
   * supply it rather than fall back to something anonymous.
   */
  oligoName: string;
}

/**
 * Who is carrying the mismatch — by lineage, or by country.
 *
 * The caption is the load-bearing part. Every share in this table has
 * `attribution.total` as its denominator, and `total` is the *mismatch-carrying
 * set*, not the scope and not the assessable set. "60%" here means 60% of the
 * sequences that already have a mismatch, which is a completely different
 * statement from 60% of sequences in scope — and it is the one a reader is
 * most likely to get wrong, because the surrounding card is full of
 * percentages taken over the assessable set. So the denominator is named in
 * words, with its size, above the numbers rather than in a footnote.
 *
 * The `other` and `unassigned` rows appear only when they are non-zero, and
 * carry their counts like any other row. `unassigned` is not a residual and
 * not an error: it is sequences with no value recorded for this field, which
 * is a fact about the metadata rather than about the variant, and folding it
 * into `other` would hide that.
 */
export function AttributionTable({ attribution, label, oligoName }: AttributionTableProps) {
  const regionLabel = `${label}: ${oligoName}`;
  const { rows, otherCount, unassignedCount, total } = attribution;
  const shareOf = (count: number) => (total === 0 ? 0 : count / total);

  if (rows.length === 0 && otherCount === 0 && unassignedCount === 0) {
    return (
      <section aria-label={regionLabel} className="flex flex-col gap-2">
        <h4 className="text-base font-semibold text-slate-900">
          {label}
        </h4>
        <p className="text-sm text-slate-700">
          No sequences carry a mismatch at this site, so there is nothing to attribute.
        </p>
      </section>
    );
  }

  return (
    <section aria-label={regionLabel} className="flex flex-col gap-2">
      <h4 className="text-base font-semibold text-slate-900">
        {label}
      </h4>

      <table className="w-full max-w-md border-collapse text-sm">
        <caption className="mb-1 text-left text-xs text-slate-600">
          {`Shares are of sequences carrying a mismatch in this binding site (n = ${formatCount(total)}), not of all sequences in scope.`}
        </caption>
        <thead>
          <tr className="border-b border-slate-300 text-left">
            <th scope="col" className="py-1 pr-3 font-medium">
              {label}
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Sequences
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.value} className="border-b border-slate-100">
              <th scope="row" className="py-1 pr-3 font-normal">
                {row.value}
              </th>
              <td className="py-1 pr-3 text-right tabular-nums">{formatCount(row.count)}</td>
              <td className="py-1 text-right tabular-nums">{formatPercent(row.share)}</td>
            </tr>
          ))}

          {otherCount > 0 && (
            <tr className="border-b border-slate-100 text-slate-700">
              <th scope="row" className="py-1 pr-3 font-normal">
                Other
              </th>
              <td className="py-1 pr-3 text-right tabular-nums">{formatCount(otherCount)}</td>
              <td className="py-1 text-right tabular-nums">{formatPercent(shareOf(otherCount))}</td>
            </tr>
          )}

          {unassignedCount > 0 && (
            <tr className="text-slate-700">
              <th scope="row" className="py-1 pr-3 font-normal">
                Unassigned
              </th>
              <td className="py-1 pr-3 text-right tabular-nums">{formatCount(unassignedCount)}</td>
              <td className="py-1 text-right tabular-nums">
                {formatPercent(shareOf(unassignedCount))}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {unassignedCount > 0 && (
        <p className="text-xs text-slate-600">
          Sequences in the last row have no value recorded for this field. That is a gap in the
          metadata, not a category of its own.
        </p>
      )}
    </section>
  );
}

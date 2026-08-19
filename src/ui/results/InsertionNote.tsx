import type { WindowInsertion } from '../../core/analysis/insertions';
import { formatCount, formatPercent } from '../format';

interface InsertionNoteProps {
  insertions: WindowInsertion[];
  /** The window's full-coverage denominator, borrowed for these fractions. */
  denominator: number;
  /**
   * The oligo whose binding site these insertions sit in. Required for the
   * same reason as `AttributionTable`'s: one of these renders per oligo, and
   * several regions sharing one name is a landmark list that navigates
   * nowhere.
   */
  oligoName: string;
}

const VISIBLE_INSERTIONS = 3;

/**
 * Insertions inside the binding site.
 *
 * Absent entirely when there are none — an empty "no insertions" panel would
 * imply the tool had checked and found the site clean, and the insertions
 * endpoint is not the kind of evidence that supports that claim.
 *
 * Every fraction here is qualified, because `insertionsInWindow` divides by
 * the *window's* full-coverage denominator: LAPIS's insertions endpoint
 * reports no coverage of its own, so there is no denominator that belongs to
 * these counts. Borrowing one is the only option available and it is not
 * exact — the set of sequences with a definite call across the site is not the
 * set of sequences an insertion could have been called in. So the share is
 * shown next to both absolute numbers and labelled approximate.
 *
 * Insertions are not folded into the mismatch rate. They are reported by a
 * separate endpoint with a separate denominator, and adding them to a
 * percentage computed from the mutations endpoint would produce a number with
 * no coherent meaning at all.
 */
export function InsertionNote({ insertions, denominator, oligoName }: InsertionNoteProps) {
  if (insertions.length === 0) return null;
  const ranked = [...insertions].sort((a, b) => b.count - a.count);
  const visible = ranked.slice(0, VISIBLE_INSERTIONS);
  const remaining = ranked.slice(VISIBLE_INSERTIONS);
  const item = (insertion: WindowInsertion) => (
    <li key={`${String(insertion.refPos)}-${insertion.insertedSymbols}`}>
      {`After position ${formatCount(insertion.refPos)}: ${insertion.insertedSymbols} inserted in ${formatCount(insertion.count)} of ${formatCount(denominator)} assessable sequences (approximately ${formatPercent(insertion.fractionOfDenominator)}).`}
    </li>
  );

  return (
    <section aria-label={`Insertions in this binding site: ${oligoName}`} className="flex flex-col gap-2">
      <h4 className="text-base font-semibold text-slate-900">
        Insertions in this binding site
      </h4>
      <p className="text-sm text-slate-700">
        {`${formatCount(insertions.length)} insertion${insertions.length === 1 ? '' : 's'} reported. Highest-count entries:`}
      </p>

      <ul className="list-disc pl-5 text-sm text-slate-700">
        {visible.map(item)}
      </ul>

      {remaining.length > 0 && (
        <details className="text-sm text-slate-700">
          <summary className="cursor-pointer">{`Show ${formatCount(remaining.length)} other insertion${remaining.length === 1 ? '' : 's'}`}</summary>
          <ul className="mt-2 list-disc pl-5">{remaining.map(item)}</ul>
        </details>
      )}

      <p className="text-xs text-slate-600">
        The insertions endpoint reports no coverage of its own, so these shares borrow this site&apos;s
        full-coverage denominator and are approximate. They are reported separately and are not
        included in the mismatch rate above.
      </p>
    </section>
  );
}

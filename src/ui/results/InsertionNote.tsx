import { useId } from 'react';
import type { WindowInsertion } from '../../core/analysis/insertions';
import { formatCount, formatPercent } from '../format';

interface InsertionNoteProps {
  insertions: WindowInsertion[];
  /** The window's full-coverage denominator, borrowed for these fractions. */
  denominator: number;
}

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
export function InsertionNote({ insertions, denominator }: InsertionNoteProps) {
  const headingId = useId();
  if (insertions.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h4 id={headingId} className="text-base font-semibold text-slate-900">
        Insertions in this binding site
      </h4>

      <ul className="list-disc pl-5 text-sm text-slate-700">
        {insertions.map((insertion) => (
          <li key={`${String(insertion.refPos)}-${insertion.insertedSymbols}`}>
            {`After position ${formatCount(insertion.refPos)}: ${insertion.insertedSymbols} inserted in ${formatCount(insertion.count)} of ${formatCount(denominator)} assessable sequences (approximately ${formatPercent(insertion.fractionOfDenominator)}).`}
          </li>
        ))}
      </ul>

      <p className="text-xs text-slate-600">
        The insertions endpoint reports no coverage of its own, so these shares borrow this site&apos;s
        full-coverage denominator and are approximate. They are reported separately and are not
        included in the mismatch rate above.
      </p>
    </section>
  );
}

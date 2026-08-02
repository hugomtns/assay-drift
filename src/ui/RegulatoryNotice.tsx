import { REGULATORY_STATEMENT } from '../state/store';

/**
 * The regulatory statement, always rendered as plain visible text and exposed
 * to assistive technology as a note. Never place this inside a collapsible
 * disclosure (e.g. <details>) -- it must never be hidden or require a click
 * to reveal.
 */
export function RegulatoryNotice() {
  return (
    <aside role="note" className="text-sm text-slate-600">
      {REGULATORY_STATEMENT}
    </aside>
  );
}

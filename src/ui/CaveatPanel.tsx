import type { Diagnostic } from '../core/analysis/diagnostics';
import type { AnalysisResult } from '../core/analysis/run';

/**
 * The five standing caveats (Appendix C.2). They are fixed text, rendered in
 * full on every result, in this order, whatever the data says.
 *
 * Each string is one caveat and must stay one string: the panel renders each
 * as the entire text of a single element, so wrapping a fragment of one in a
 * nested <strong>/<em> would split it across elements and break both the
 * screen-reader reading and the exact-text queries in the tests.
 *
 * These are never conditioned on the analysis. A live diagnostic may say
 * something overlapping -- a large coverage gap raises both caveat 2 and the
 * live `coverage-gap` diagnostic -- and that is intended: the fixed five state
 * what is always true of this kind of data, the live ones state what happened
 * to this query.
 */
// The spec names this export and this module, and `react-refresh`'s
// `allowConstantExport` only forgives literals, not arrays. Splitting the text
// into its own module to satisfy the rule would put the five strings a file
// away from the component whose contract they are, and a re-export would be
// flagged just the same. Fast refresh losing component state when this frozen
// list is edited is not a cost worth that.
// eslint-disable-next-line react-refresh/only-export-components
export const FIXED_CAVEATS: readonly string[] = [
  'Sequence databases are not a random sample. Which countries sequence, how much, and which specimens they choose all vary — the figures below describe the sequences that exist, not the infections that happened.',
  'A position with no reported mutation may be conserved, or may simply not have been sequenced well. Sequences with an ambiguous base anywhere in a binding site are excluded from the denominator and reported as the coverage gap.',
  'Sequences are usually deposited weeks after collection. The most recent part of any trend is incomplete, not necessarily quiet.',
  'An in-silico mismatch is not the same as assay failure. Where a mismatch sits matters, other mismatches may compensate, and only a wet-lab test can tell you what your assay actually does.',
  'This tool evaluates oligos you give it. It does not design assays, model melting temperature, or predict amplification efficiency.',
];

/**
 * Every diagnostic raised anywhere in the analysis, in oligo order, with each
 * `id` kept only the first time it appears.
 *
 * De-duplication is by `id`, not by message, and is deliberate. Most
 * diagnostics are properties of the *scope* rather than of one oligo --
 * deposition lag, geographic concentration, undated records -- so with three
 * oligos over one dataset the same warning is produced three times, and
 * printing it three times would read as three separate problems. First
 * occurrence wins.
 *
 * The others -- `small-n`, `coverage-gap`, `geographic-concentration`,
 * `undated-records` -- are properties of one *binding site*, so first-wins
 * means one oligo speaks for the panel. That is only safe because
 * `computeDiagnostics` now names the oligo in every one of those messages;
 * they used to say "this binding site" under a heading that speaks for the
 * whole run, with nothing on screen saying which site. Any per-site diagnostic
 * added later must name its oligo too, or this de-duplication will silently
 * mislabel it.
 */
function liveDiagnostics(result: AnalysisResult): Diagnostic[] {
  const byId = new Map<string, Diagnostic>();
  // Run-level first, and not only for ordering: these describe the scope --
  // the size of the shared mutations payload, and anything added later that is
  // a property of the query rather than of a binding site -- so if an oligo
  // ever reports the same `id`, the copy that speaks for the whole run is the
  // one that belongs under a run-wide heading.
  for (const diagnostic of result.diagnostics) {
    if (!byId.has(diagnostic.id)) byId.set(diagnostic.id, diagnostic);
  }
  for (const oligo of result.oligos) {
    for (const diagnostic of oligo.diagnostics) {
      if (!byId.has(diagnostic.id)) byId.set(diagnostic.id, diagnostic);
    }
  }
  return [...byId.values()];
}

interface CaveatPanelProps {
  result: AnalysisResult;
}

/**
 * What these numbers do not tell you.
 *
 * Not "Step 5": the step navigation has four steps, and this panel now sits
 * above the figures rather than after them, so a fifth number would have been
 * wrong twice over. It is not a step the user takes; it is what they should
 * have in hand before reading the ones they asked for.
 *
 * Global Constraint 7 -- this panel is never collapsed. No <details>, no
 * `hidden`, no accordion, no "show more". A caveat behind a click is a caveat
 * the user has already decided not to read, and the entire point of the panel
 * is that the reader meets it without choosing to. Anything added here must
 * stay unconditionally visible.
 */
export function CaveatPanel({ result }: CaveatPanelProps) {
  const diagnostics = liveDiagnostics(result);

  return (
    <section aria-labelledby="caveat-panel-heading" className="flex flex-col gap-4">
      <h2 id="caveat-panel-heading" className="text-xl font-semibold">
        Before you read these numbers: what they do not tell you
      </h2>

      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-slate-700">
        {FIXED_CAVEATS.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>

      {diagnostics.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">About this particular analysis</h3>
          {/*
            The severity of a diagnostic used to be an amber text colour and
            nothing else -- invisible in greyscale, invisible to a screen
            reader, and invisible to anyone who cannot separate amber-900 from
            slate-700. WCAG 1.4.1: colour is never the only carrier. The word
            goes in front of the message, so the distinction survives being
            printed, read aloud, or pasted into an email as plain text.
          */}
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {diagnostics.map((diagnostic) => (
              <li
                key={diagnostic.id}
                className={diagnostic.severity === 'warn' ? 'text-amber-900' : 'text-slate-700'}
              >
                <span className="font-semibold">
                  {diagnostic.severity === 'warn' ? 'Warning: ' : 'Note: '}
                </span>
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

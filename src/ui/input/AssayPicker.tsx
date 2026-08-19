import { useState } from 'react';
import { getPathogen } from '../../core/registry';
import libraryRaw from '../../data/assays/library.json';
import { parseLibrary, type LibraryAssay } from '../../data/assays/schema';
import { useAppStore } from '../../state/store';

/**
 * Parsed once, at module load, and deliberately not defended against.
 *
 * `parseLibrary` throws on a malformed entry, and `npm run verify:assays` runs
 * the same parse in CI, so a library that would break this import cannot reach
 * a build. Swallowing the error here would trade a loud failure at the gate for
 * a silently shorter list of assays in the product, which is the wrong way
 * round for the one file whose contents every published number depends on.
 */
const LIBRARY = parseLibrary(libraryRaw);

/**
 * A link label short enough to read and to hear.
 *
 * The full `citation.title` used to be the link text, and the WHO titles in
 * the library run to a paragraph -- "WHO information for the molecular
 * detection of influenza viruses (2024), Annex 2 Protocol 2, table 'Primers
 * and probes used for detecting influenza A subtype H1pdm09 and H3 viruses'
 * (p. 25)". A screen reader announces a link by its whole name, so that was a
 * paragraph read aloud for every entry in the list.
 *
 * `citation.source` opens with the publishing body and then qualifies it after
 * a comma, a semicolon or a bracket, so everything from the first of those
 * onwards is the qualification: "US Centers for Disease Control and
 * Prevention", "Corman VM et al.", "World Health Organization". The full title
 * stays on the anchor's `title` attribute, which is exposed as the link's
 * accessible *description* -- available on demand, not read out first.
 */
function shortSource(source: string): string {
  const head = source.split(/[,;(]/)[0];
  return head === undefined || head.trim() === '' ? source : head.trim();
}

/**
 * Step 1's alternative to pasting: pick a published assay whose sequences have
 * been transcribed from a cited source and machine-verified against the bundled
 * reference (`docs/assay-sources.md`, Global Constraint 2).
 *
 * Every library oligo carries a role, so choosing an assay skips the role
 * guessing that pasted text needs -- the roles arrive already assigned, which is
 * the whole point of picking from the library rather than typing.
 *
 * Selecting an assay moves straight to step 2 rather than leaving the choice
 * sitting on step 1. That is not just convenience: `OligoInputPanel` commits its
 * own (empty) parse to the store on a debounce whenever its textarea changes, and
 * `setOligos` clears `chosenSites`. Leaving the user on step 1 with library
 * oligos in the store would mean one keystroke in the textarea silently replaces
 * them. Navigating away closes that window.
 */
interface AssayPickerProps {
  onRunExample?: () => void;
}

export function AssayPicker({ onRunExample }: AssayPickerProps) {
  const pathogenId = useAppStore((s) => s.pathogenId);
  const setOligos = useAppStore((s) => s.setOligos);
  const goTo = useAppStore((s) => s.goTo);
  const [search, setSearch] = useState({ pathogenId, query: '' });
  const pathogen = getPathogen(pathogenId);
  const assays = LIBRARY.assays.filter((assay) => assay.pathogenId === pathogenId);
  const searchQuery = search.pathogenId === pathogenId ? search.query : '';
  const filteredAssays = assays.filter((assay) =>
    `${assay.name} ${assay.target} ${assay.citation.source}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );

  const select = (assay: LibraryAssay) => {
    if (assay.pathogenId !== pathogenId) return;
    setOligos(
      assay.oligos.map((oligo, index) => ({
        id: `oligo-${index}`,
        name: oligo.name,
        role: oligo.role,
        sequence: oligo.sequence,
      })),
    );
    goTo('binding');
  };

  return (
    <section aria-labelledby="assay-picker-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="assay-picker-heading" className="text-base font-semibold">
          Published assays
        </h2>
        <p className="text-sm text-slate-600">
          Choose a checked assay, with roles already assigned.
        </p>
      </div>

      {onRunExample !== undefined && pathogenId === 'sars-cov-2' && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Recommended example</p>
            <p className="text-sm text-slate-600">CDC N1 assay, scoped from 2020.</p>
          </div>
          <button
            type="button"
            onClick={onRunExample}
            className="rounded border border-slate-900 px-3 py-2 text-sm text-slate-900"
          >
            See how the CDC N1 assay has drifted since 2020
          </button>
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-slate-900 underline underline-offset-4">
          Browse published assays
        </summary>
        <div className="mt-4 flex flex-col gap-3">
          <h3 id="assay-picker-list-heading" className="text-sm font-semibold text-slate-900">
            {pathogen.label}
          </h3>
          {assays.length > 5 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="assay-library-search" className="text-sm font-medium text-slate-900">
                Search assays
              </label>
              <input
                id="assay-library-search"
                type="search"
                value={searchQuery}
                onChange={(event) => { setSearch({ pathogenId, query: event.target.value }); }}
                className="max-w-sm rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
          )}
          {filteredAssays.length === 0 ? (
            <p className="text-sm text-slate-600">No published assays match this search.</p>
          ) : (
            <ul aria-labelledby="assay-picker-list-heading" className="divide-y divide-slate-200 border-y border-slate-200">
              {filteredAssays.map((assay) => (
                <li key={assay.id} className="flex flex-col items-start gap-1 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      select(assay);
                    }}
                    className="text-left font-medium text-slate-900 underline"
                  >
                    {assay.name}
                  </button>
                  <p className="text-sm text-slate-700">
                    {assay.target} &middot; {assay.oligos.length} oligos
                  </p>
                  <a
                    href={assay.citation.url}
                    target="_blank"
                    rel="noreferrer"
                    title={assay.citation.title}
                    className="text-xs text-slate-600 underline"
                  >
                    {`Source: ${shortSource(assay.citation.source)}`}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}

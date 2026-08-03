import { useEffect, useState, type ChangeEvent } from 'react';
import { queryAggregated, type AggregatedRow } from '../../core/lapis/endpoints';
import type { LapisTransport } from '../../core/lapis/transport';
import { getPathogen, type PathogenId } from '../../core/registry';
import { useAppStore } from '../../state/store';

/** Rows on screen at once for each multi-select. Enough to scan, short enough to scroll past. */
const SELECT_ROWS = 8;

/**
 * The outcome of one option-list load, stamped with the pathogen it describes.
 * The stamp is what makes the lists reset on a pathogen change *during render*
 * rather than from a setState inside the effect body: a result whose
 * `pathogenId` is not the current one is simply not read, so there is never a
 * frame in which H5N1's clades are offered under the SARS-CoV-2 label, and no
 * cascading render is needed to clear them.
 */
interface OptionLists {
  pathogenId: PathogenId;
  countries: string[];
  lineages: string[];
  /** The load finished but failed. Distinct from "still loading" (`null`). */
  failed: boolean;
}

/**
 * The distinct, sorted, non-empty string values of one metadata field across
 * an aggregated response. `AggregatedRow`'s index signature is
 * `string | number | null`, and LAPIS returns `null` for sequences with no
 * value recorded for the field -- a `null` country is not a country the user
 * can pick, so it is dropped rather than rendered as an empty option.
 */
function optionValues(rows: AggregatedRow[], field: string): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[field];
    if (typeof value === 'string' && value !== '') seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

interface ScopeControlsProps {
  onRun: () => void;
  /**
   * Optional on purpose, and with no default. Without it the option lists are
   * simply not loaded and both selects render empty -- which is the same state
   * the control is in while a real load is still in flight, and is safe
   * because an empty filter means "all". Defaulting to a live transport here
   * would make every render of this component (including every unit test that
   * does not pass one) hit the network. The wizard supplies the cached
   * transport when it mounts this step.
   */
  transport?: LapisTransport | undefined;
}

/**
 * Step 3 of the wizard: choose which sequences the analysis runs over.
 *
 * Dates come prefilled from the store's scope, which `defaultScope` derives
 * from the pathogen's `defaultWindowMonths`. Both ends are inclusive (Global
 * Constraint 3), and the labels say so, because a bare pair of dates cannot
 * tell a user whether the last day is in or out.
 *
 * Every date the browser hands us is either '' or a valid `yyyy-mm-dd`, so the
 * change handler can write straight through to `setScope` with no parsing.
 * That does mean the store briefly holds an empty date while the user is
 * retyping one; "Run analysis" is disabled for that state as well as for an
 * inverted range, so nothing downstream can run on a half-edited scope.
 *
 * Validation is a string comparison, not a `Date` comparison: ISO
 * `yyyy-mm-dd` sorts lexicographically in date order, and `new Date('...')`
 * would drag in a timezone that has no business deciding whether the user's
 * range is inverted.
 *
 * The country and lineage option lists are loaded once per pathogen, from an
 * `aggregated` call per field with *no* other filters. Leaving the date range
 * out is deliberate: it keeps the request identical for the whole session, so
 * editing a date cannot re-issue it, and it keeps the cache key stable. The
 * cost is that the lists are pathogen-wide -- a country with nothing in the
 * chosen window still appears -- which is a far smaller surprise than a
 * country vanishing from the list mid-edit.
 *
 * No cache lives here. `withCache` already gives per-key memoisation,
 * in-flight de-duplication and a 6-hour sessionStorage entry one layer down,
 * around the transport this component is handed; a second cache would only be
 * a second thing to invalidate.
 *
 * The load is abortable (Global Constraint 9). The effect's cleanup aborts the
 * controller and flips `live`, so both unmount and a pathogen change cancel
 * the request in flight, and neither the success nor the failure path can set
 * state afterwards. A failed load is not an error state for the step: the
 * selects stay mounted and usable, the step still runs, and the notice says so
 * -- an empty filter already means "all", so an unavailable list costs the user
 * the ability to narrow, not the ability to proceed.
 */
export function ScopeControls({ onRun, transport }: ScopeControlsProps) {
  const pathogenId = useAppStore((s) => s.pathogenId);
  const scope = useAppStore((s) => s.scope);
  const setScope = useAppStore((s) => s.setScope);
  const cfg = getPathogen(pathogenId);

  const [loaded, setLoaded] = useState<OptionLists | null>(null);

  useEffect(() => {
    if (transport === undefined) return;
    const controller = new AbortController();
    let live = true;
    const { signal } = controller;

    Promise.all([
      queryAggregated(transport, cfg, {}, { fields: [cfg.countryField], signal }),
      queryAggregated(transport, cfg, {}, { fields: [cfg.lineageField], signal }),
    ])
      .then(([countries, lineages]) => {
        if (!live) return;
        setLoaded({
          pathogenId: cfg.id,
          countries: optionValues(countries.data, cfg.countryField),
          lineages: optionValues(lineages.data, cfg.lineageField),
          failed: false,
        });
      })
      .catch(() => {
        // Also catches the AbortError raised by the cleanup below. `live` is
        // already false in that case, so an aborted load never reports itself
        // as a failure and never writes over the run that replaced it.
        if (!live) return;
        setLoaded({ pathogenId: cfg.id, countries: [], lineages: [], failed: true });
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [transport, cfg]);

  // A result for a different pathogen is stale by construction, so it is
  // discarded here rather than cleared by a setState in the effect above.
  const options = loaded !== null && loaded.pathogenId === pathogenId ? loaded : null;
  const countryOptions = options?.countries ?? [];
  const lineageOptions = options?.lineages ?? [];
  // No transport means no load was ever started, which renders identically to
  // a load that returned nothing -- not as a stuck spinner.
  const loading = transport !== undefined && options === null;
  const failed = options?.failed === true;

  const missingDate = scope.dateFrom === '' || scope.dateTo === '';
  const inverted = !missingDate && scope.dateTo < scope.dateFrom;
  const canRun = !missingDate && !inverted;

  const selectedValues = (event: ChangeEvent<HTMLSelectElement>): string[] =>
    Array.from(event.target.selectedOptions, (option) => option.value);

  const lineagePlural = `${cfg.lineageLabel}s`;

  return (
    <section aria-labelledby="scope-controls-heading" className="flex flex-col gap-4">
      <h2 id="scope-controls-heading" className="text-xl font-semibold">
        Step 3: Choose the sequences to analyse
      </h2>
      <p className="text-sm text-slate-700">
        {`Sequences are selected by ${cfg.label} collection date. Both dates are included in the range.`}
      </p>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="scope-date-from" className="text-sm font-medium text-slate-900">
            Collected from (inclusive)
          </label>
          <input
            id="scope-date-from"
            type="date"
            value={scope.dateFrom}
            onChange={(e) => setScope({ dateFrom: e.target.value })}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="scope-date-to" className="text-sm font-medium text-slate-900">
            Collected to (inclusive)
          </label>
          <input
            id="scope-date-to"
            type="date"
            value={scope.dateTo}
            onChange={(e) => setScope({ dateTo: e.target.value })}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </div>
      </div>

      {inverted && (
        <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-900">
          End date must be on or after the start date.
        </p>
      )}
      {missingDate && (
        <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-900">
          Enter both a start and an end collection date.
        </p>
      )}

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="scope-countries" className="text-sm font-medium text-slate-900">
            Country
          </label>
          <select
            id="scope-countries"
            multiple
            size={SELECT_ROWS}
            aria-describedby="scope-countries-hint"
            value={scope.countries}
            onChange={(e) => setScope({ countries: selectedValues(e) })}
            className="min-w-56 rounded border border-slate-300 px-2 py-1"
          >
            {countryOptions.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
          <p id="scope-countries-hint" className="text-xs text-slate-600">
            Leave empty to include all countries.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="scope-lineages" className="text-sm font-medium text-slate-900">
            {cfg.lineageLabel}
          </label>
          <select
            id="scope-lineages"
            multiple
            size={SELECT_ROWS}
            aria-describedby="scope-lineages-hint"
            value={scope.lineages}
            onChange={(e) => setScope({ lineages: selectedValues(e) })}
            className="min-w-56 rounded border border-slate-300 px-2 py-1"
          >
            {lineageOptions.map((lineage) => (
              <option key={lineage} value={lineage}>
                {lineage}
              </option>
            ))}
          </select>
          <p id="scope-lineages-hint" className="text-xs text-slate-600">
            {`Leave empty to include all ${lineagePlural}.`}
          </p>
        </div>
      </div>

      {loading && (
        <p role="status" className="text-xs text-slate-600">
          {`Loading the country and ${cfg.lineageLabel.toLowerCase()} lists. You can carry on without them.`}
        </p>
      )}
      {failed && (
        <p role="status" className="text-xs text-slate-600">
          {`The country and ${cfg.lineageLabel.toLowerCase()} lists could not be loaded. Leaving both empty analyses everything, so you can still continue.`}
        </p>
      )}

      <button
        type="button"
        onClick={onRun}
        disabled={!canRun}
        className="self-start rounded bg-slate-900 px-4 py-2 text-white disabled:bg-slate-300"
      >
        Run analysis
      </button>
    </section>
  );
}

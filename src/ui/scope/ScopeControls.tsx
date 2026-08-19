import { useEffect, useState } from 'react';
import { queryAggregated, type AggregatedRow } from '../../core/lapis/endpoints';
import type { LapisTransport } from '../../core/lapis/transport';
import { getPathogen, type PathogenId } from '../../core/registry';
import { useAppStore } from '../../state/store';


/**
 * Ids of the three message regions. Every one is *always* mounted with its
 * text swapped in rather than being conditionally mounted, for two reasons: a
 * live region that appears at the same instant as its text is frequently never
 * announced, and `aria-describedby` must not point at an id that is absent
 * from the document half the time.
 */
const DATE_RANGE_MESSAGE_ID = 'scope-date-range-message';
const DATE_MISSING_MESSAGE_ID = 'scope-date-missing-message';
const OPTIONS_MESSAGE_ID = 'scope-options-message';

interface FilterListProps {
  label: string;
  values: readonly string[];
  selected: readonly string[];
  unmatched: readonly string[];
  onChange: (values: string[]) => void;
}

interface SelectedFiltersProps {
  label: string;
  values: readonly string[];
  unmatched: readonly string[];
  onRemove: (value: string) => void;
}

function SelectedFilters({ label, values, unmatched, onRemove }: SelectedFiltersProps) {
  if (values.length === 0) return null;

  return (
    <ul aria-label={`Selected ${label} filters`} className="flex flex-wrap gap-2">
      {values.map((value) => {
        const unavailable = unmatched.includes(value);
        return (
          <li key={value}>
            <button
              type="button"
              onClick={() => onRemove(value)}
              className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-sm text-slate-800"
              aria-label={`Remove ${label} filter ${value}${unavailable ? ', not in the loaded dataset' : ''}`}
            >
              {`${label}: ${value} \u00d7`}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FilterList({ label, values, selected, unmatched, onChange }: FilterListProps) {
  const [query, setQuery] = useState('');
  const visible = values.filter((value) => value.toLowerCase().includes(query.toLowerCase()));
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);

  return (
    <fieldset className="flex min-w-56 flex-col gap-2">
      <legend className="text-sm font-medium text-slate-900">{label}</legend>
      <label className="sr-only" htmlFor={`scope-filter-${label}`}>{`Filter ${label}`}</label>
      <input
        id={`scope-filter-${label}`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Filter ${label}`}
        className="rounded border border-slate-300 px-2 py-1 text-sm"
      />
      <div className="max-h-52 overflow-y-auto rounded border border-slate-300 p-2">
        {[...visible, ...unmatched].map((value) => (
          <label key={value} className="flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The outcome of one option-list load, stamped with the *inputs that produced
 * it* -- the pathogen and the transport, which together are the effect's whole
 * dependency list. The stamps are what make the lists reset *during render*
 * rather than from a setState inside the effect body: a result whose stamps are
 * not the current ones is simply not read, so there is never a frame in which
 * H5N1's clades are offered under the SARS-CoV-2 label, and no cascading render
 * is needed to clear them. (A setState in the effect body would also be a
 * `react-hooks/set-state-in-effect` lint error, so this is the sanctioned shape
 * as well as the cheaper one.)
 *
 * Both stamps are load-bearing and neither subsumes the other, because each
 * covers the change the other cannot see:
 *
 * - A pathogen change re-runs the effect with the *same* transport, so only the
 *   `pathogenId` stamp discards the previous lists.
 * - A transport swap re-runs it under the *same* pathogen, so only the
 *   `transport` stamp does. Without it the previous run's lists stay on screen,
 *   stamped with a pathogen that still matches, presented as current while the
 *   replacement query is in flight -- and `loading` (below) is false at the same
 *   time, so nothing on screen says otherwise.
 *
 * Together they hold the invariant the `loading` derivation depends on: a query
 * being in flight and a loaded list being on screen cannot both be true.
 */
interface OptionLists {
  pathogenId: PathogenId;
  /**
   * Identity comparison only -- never called. The prop is required to be
   * referentially stable (see `ScopeControlsProps`), which is what makes this a
   * usable stamp: a caller that rebuilds its transport every render already
   * re-queries every render, and would now also show the loading state forever.
   */
  transport: LapisTransport;
  countries: string[];
  lineages: string[];
  /** The load finished but failed. Distinct from "still loading" (`null`). */
  failed: boolean;
}

/**
 * Explicit 'en' collation. `localeCompare` with no locale sorts by the host's
 * default, so option order would depend on the machine the app happens to run
 * on the moment a name carries a diacritic -- Aaland/Aland, Cote/Cote d'Ivoire.
 */
const sorted = (values: string[]): string[] => [...values].sort((a, b) => a.localeCompare(b, 'en'));

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
  return sorted([...seen]);
}

/** The optgroup a selected value sits in when the dataset does not have it. */

interface MergedOptions {
  /** Rendered plainly, in the order the load returned them. */
  options: string[];
  /**
   * Selected values the loaded list does not contain, rendered inside a
   * labelled optgroup. Empty whenever there is no loaded list to judge against.
   */
  unmatched: string[];
}

/**
 * The options actually rendered: everything the load returned, plus any value
 * already selected that the list does not contain -- with the second group kept
 * distinguishable from the first.
 *
 * Merging at all is what stops a selection filtering the analysis while being
 * invisible. The selection lives in the store; the options that give it
 * something to sit in live in this component's `useState`. So a remount (step
 * back, step forward -- fresh state, nothing loaded yet) or a failed load
 * leaves `<select value={['Germany']}>` with no children: an empty listbox,
 * under a hint reading "Leave empty to include all countries", while
 * `scopeToFilters` narrows the query to Germany regardless. The UI would be
 * asserting the analysis is unfiltered at the exact moment it is filtered, and
 * failing silently while it did.
 *
 * Separating the two groups is what stops the opposite failure, and it is the
 * one permalinks introduce (Task 5.3). Matching is by exact string, so a link
 * carrying `countries: ["germany"]` -- lower case, a typo, or a value from a
 * different dataset -- used to render an option indistinguishable from a real
 * one. The analysis then returns nothing while every part of the UI insists the
 * filter is legitimate: the worst shape a caveat can take is an absent one.
 *
 * `loaded === null` means *no evidence*, not *no match*: nothing has arrived
 * yet, or the load failed. A value cannot be reported as absent from a list
 * that was never seen, so in that case everything is merged in plainly and the
 * component's existing loading/failure notices speak instead.
 */
function mergeSelection(loaded: string[] | null, selected: string[]): MergedOptions {
  if (loaded === null) return { options: sorted([...new Set(selected)]), unmatched: [] };
  const unmatched = selected.filter((value) => !loaded.includes(value));
  return { options: loaded, unmatched: sorted([...new Set(unmatched)]) };
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
   *
   * **It must be referentially stable.** It is an effect dependency, so a
   * transport constructed inline in the caller's render --
   * `<ScopeControls transport={withCache(makeFetchTransport())} />` -- is a new
   * object every render and makes this component fire, then abort, two
   * requests per render, forever, never settling. Build it once (a module
   * constant, `useMemo`, or a ref) and pass the same instance.
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
 * controller and flips `live`, so unmount, a pathogen change and a transport
 * swap all cancel the request in flight, and neither the success nor the
 * failure path can set state afterwards.
 *
 * `live` and the stamps look redundant but are not, and the difference is worth
 * stating because it was originally got wrong here. An aborted run's `.catch`
 * closes over the `cfg` and `transport` it was started with, so its result is
 * stamped with those and discarded at render for as long as either of them has
 * moved on. What the stamps cannot catch is inputs that come *back*: pathogen
 * A -> B -> A, or transport T1 -> T2 -> T1. The first run's abort then rejects
 * with a result stamped exactly as the current render, both stamps pass, and
 * without `live` a spurious "could not be loaded" is painted over a reload that
 * is still in flight. That is the path `live` exists for, and it is also what
 * keeps an unmounted component from being written to at all.
 *
 * A failed load is not an error state for the step: the selects stay mounted
 * and usable and the step still runs, because an unavailable list costs the
 * user the ability to narrow, not the ability to proceed. The notice says so
 * -- but only when it is true. If filters are already selected, they are still
 * being applied, so the notice names them instead of claiming everything is
 * included.
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
          transport,
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
        setLoaded({ pathogenId: cfg.id, transport, countries: [], lineages: [], failed: true });
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [transport, cfg]);

  // A result produced by a different pathogen or a different transport is stale
  // by construction, so it is discarded here rather than cleared by a setState
  // in the effect above. Both stamps are needed; see `OptionLists`.
  const options =
    loaded !== null && loaded.pathogenId === pathogenId && loaded.transport === transport
      ? loaded
      : null;
  // No transport means no load was ever started, which renders identically to
  // a load that returned nothing -- not as a stuck spinner.
  const loading = transport !== undefined && options === null;
  const failed = options?.failed === true;
  // A failed load returns empty lists, which is not the same fact as "the
  // dataset does not contain this value". Only a load that succeeded is
  // evidence, so only that becomes a list to judge a selection against.
  const dataset = options !== null && !options.failed ? options : null;
  // Merged with the current selection so a filter can never be applied without
  // being on screen, and split so one the dataset does not have cannot pass
  // itself off as one it does. See `mergeSelection`.
  const countryOptions = mergeSelection(dataset?.countries ?? null, scope.countries);
  const lineageOptions = mergeSelection(dataset?.lineages ?? null, scope.lineages);
  const unmatched = [...countryOptions.unmatched, ...lineageOptions.unmatched];

  const fromMissing = scope.dateFrom === '';
  const toMissing = scope.dateTo === '';
  const missingDate = fromMissing || toMissing;
  const inverted = !missingDate && scope.dateTo < scope.dateFrom;
  const canRun = !missingDate && !inverted;

  // Each date field points at the message that is about *it*: an empty field
  // gets the missing-date message, and both fields get the range message,
  // because an inverted range is a property of the pair and either end is a
  // legitimate place to fix it.
  const describedBy = (isMissing: boolean): string | undefined => {
    const ids: string[] = [];
    if (isMissing) ids.push(DATE_MISSING_MESSAGE_ID);
    if (inverted) ids.push(DATE_RANGE_MESSAGE_ID);
    return ids.length > 0 ? ids.join(' ') : undefined;
  };
  // `aria-disabled`, not `disabled` (Task 6.2, requirement 2). `disabled`
  // keeps the button unactivatable but also removes it from the tab order, so
  // a keyboard user tabbing through this form never encounters "Run analysis"
  // at all and is given no account of why the step will not advance.
  // `aria-disabled` keeps it focusable and announced as disabled, and the
  // `onClick` below refuses to act, so it is inert in exactly the same way.
  // The reason travels with it as a description either way.
  const blockingMessageId = missingDate
    ? DATE_MISSING_MESSAGE_ID
    : inverted
      ? DATE_RANGE_MESSAGE_ID
      : undefined;

  // `cfg.lineageLabel` is used verbatim, never lower-cased: "HA clade" is an
  // acronym plus a word, and `toLowerCase()` turned it into "ha clade".
  const listNames = `country and ${cfg.lineageLabel}`;
  const retained = [...scope.countries, ...scope.lineages];
  let optionsMessage = '';
  if (loading) {
    optionsMessage = `Loading the ${listNames} lists. You can carry on without them.`;
  } else if (failed && retained.length > 0) {
    // Naming them matters: the lists are gone, so the only other place these
    // filters appear on screen is the selects, and telling the user everything
    // is included would be false while they are still applied.
    optionsMessage = `The ${listNames} lists could not be loaded. Your filters are still being applied: ${retained.join(', ')}.`;
  } else if (failed) {
    optionsMessage = `The ${listNames} lists could not be loaded. You can still continue: with both filters left empty, the analysis covers everything.`;
  } else if (unmatched.length > 0) {
    // Reachable in practice only from a shared link, which is why the message
    // says so: a value the user picked came from the list by construction.
    // Naming them matters as much as marking them -- the optgroup is only
    // visible to someone already looking at the listbox, and this step can be
    // walked past entirely on the way to a result.
    optionsMessage = `Not in the loaded ${listNames} lists, so ${unmatched.length === 1 ? 'it matches' : 'they match'} no sequences: ${unmatched.join(', ')}. Values like these usually arrive in a shared link; remove them to widen the analysis.`;
  }

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
            aria-invalid={fromMissing || inverted}
            aria-describedby={describedBy(fromMissing)}
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
            aria-invalid={toMissing || inverted}
            aria-describedby={describedBy(toMissing)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </div>
      </div>

      {/*
        Both regions are always mounted and have their text swapped in; see the
        id constants. An inverted range is assertive -- the user has stated a
        range that cannot mean anything. A missing date is not: clearing a field
        to retype it is the normal way to edit a date, and `role="alert"` there
        interrupts on every routine edit.
      */}
      <p
        id={DATE_RANGE_MESSAGE_ID}
        role="alert"
        className={inverted ? 'rounded bg-red-50 p-2 text-sm text-red-900' : undefined}
      >
        {inverted ? 'End date must be on or after the start date.' : ''}
      </p>
      <p
        id={DATE_MISSING_MESSAGE_ID}
        role="status"
        className={missingDate ? 'rounded bg-amber-50 p-2 text-sm text-amber-900' : undefined}
      >
        {missingDate ? 'Enter both a start and an end collection date.' : ''}
      </p>

      {(scope.countries.length > 0 || scope.lineages.length > 0) && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-slate-900">Selected filters</p>
          <SelectedFilters
            label="Country"
            values={scope.countries}
            unmatched={countryOptions.unmatched}
            onRemove={(country) => setScope({ countries: scope.countries.filter((item) => item !== country) })}
          />
          <SelectedFilters
            label={cfg.lineageLabel}
            values={scope.lineages}
            unmatched={lineageOptions.unmatched}
            onRemove={(lineage) => setScope({ lineages: scope.lineages.filter((item) => item !== lineage) })}
          />
        </div>
      )}

      <details open={scope.countries.length > 0 || scope.lineages.length > 0}>
        <summary className="cursor-pointer text-sm font-medium text-slate-900">Add filters</summary>
        <div className="mt-3 flex flex-wrap gap-4">
          <FilterList label="Country" values={countryOptions.options} unmatched={countryOptions.unmatched} selected={scope.countries} onChange={(countries) => setScope({ countries })} />
          <FilterList label={cfg.lineageLabel} values={lineageOptions.options} unmatched={lineageOptions.unmatched} selected={scope.lineages} onChange={(lineages) => setScope({ lineages })} />
        </div>
      </details>

      {/*
        Always mounted, text swapped in. A `role="status"` node inserted at the
        same moment as its text is frequently never announced -- the live region
        has to exist before the content arrives for the announcement to fire.
      */}
      <p id={OPTIONS_MESSAGE_ID} role="status" className="text-xs text-slate-600">
        {optionsMessage}
      </p>

      <button
        type="button"
        onClick={() => {
          // A control that says it is disabled must behave as though it is.
          if (canRun) onRun();
        }}
        aria-disabled={!canRun}
        aria-describedby={blockingMessageId}
        className={`self-start rounded px-4 py-2 ${
          canRun ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700'
        }`}
      >
        Run analysis
      </button>
    </section>
  );
}

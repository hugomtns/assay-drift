import type { Scope } from '../../core/scope';

interface EmptyStateProps {
  scope: Scope;
  pathogenLabel: string;
  /** Pathogen-specific term for the lineage field ("Pango lineage", "HA clade"). */
  lineageLabel: string;
  onChangeScope: () => void;
}

/**
 * A scope that matched no sequences at all.
 *
 * This is not an error and must not be dressed as one: the query succeeded and
 * the honest answer is zero. But zero of nothing is also not a result, so no
 * percentage, no severity and no trend are shown -- rendering a results panel
 * over an empty denominator is exactly the "plausible, wrong" failure this
 * project exists to avoid.
 *
 * The wording follows the `no-data` diagnostic, and then does what a
 * diagnostic buried in a caveat list cannot: it repeats back the exact filters
 * that matched nothing. A user who has narrowed to one country and a six-week
 * window cannot otherwise tell which of the three constraints is the one to
 * relax, and the date range is by far the most likely culprit -- sequences are
 * deposited weeks after collection, so a window ending today is routinely
 * emptier than it looks.
 */
export function EmptyState({ scope, pathogenLabel, lineageLabel, onChangeScope }: EmptyStateProps) {
  const filters: string[] = [
    `collected ${scope.dateFrom} to ${scope.dateTo} inclusive`,
  ];
  if (scope.countries.length > 0) filters.push(`country: ${scope.countries.join(', ')}`);
  if (scope.lineages.length > 0) {
    filters.push(`${lineageLabel}: ${scope.lineages.join(', ')}`);
  }

  return (
    <section aria-labelledby="empty-state-heading" className="flex flex-col items-start gap-3">
      <h2 id="empty-state-heading" className="text-xl font-semibold">
        No sequences match this scope
      </h2>
      <p className="text-sm text-slate-700">
        {`No ${pathogenLabel} sequences match these filters. Widen the date range or remove a filter.`}
      </p>
      <ul aria-label="Filters that matched nothing" className="list-disc pl-5 text-sm text-slate-700">
        {filters.map((filter) => (
          <li key={filter}>{filter}</li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">
        Sequences are usually deposited weeks after they are collected, so a window ending today
        holds far fewer than one ending a month ago.
      </p>
      <button
        type="button"
        onClick={onChangeScope}
        className="rounded bg-slate-900 px-4 py-2 text-white"
      >
        Change the scope
      </button>
    </section>
  );
}

import { ambiguityTerm, type WindowSpec } from '../query';
import type { PathogenConfig } from '../registry';
import type { LapisResponse, LapisTransport } from './transport';

export interface AggregatedRow {
  count: number;
  [field: string]: string | number | null;
}

export interface MutationRow {
  mutation: string;
  count: number;
  /** Sequences in scope with a definite call at this position. */
  coverage: number;
  proportion: number;
  /** Segment name, or null on unsegmented genomes. */
  sequenceName: string | null;
  mutationFrom: string;
  /** Alternate allele; '-' denotes a deletion. */
  mutationTo: string;
  position: number;
}

export interface InsertionRow {
  insertion: string;
  count: number;
  insertedSymbols: string;
  position: number;
  sequenceName: string | null;
}

type Filters = Record<string, unknown>;

export async function queryAggregated(
  transport: LapisTransport,
  cfg: PathogenConfig,
  filters: Filters,
  opts: { fields?: string[]; advancedQuery?: string; signal?: AbortSignal } = {},
): Promise<LapisResponse<AggregatedRow>> {
  return transport.query<AggregatedRow>({
    baseUrl: cfg.lapisBaseUrl,
    endpoint: 'aggregated',
    body: {
      ...filters,
      ...(opts.fields ? { fields: opts.fields } : {}),
      ...(opts.advancedQuery ? { advancedQuery: opts.advancedQuery } : {}),
    },
    signal: opts.signal,
  });
}

export async function queryNucleotideMutations(
  transport: LapisTransport,
  cfg: PathogenConfig,
  filters: Filters,
  opts: { minProportion?: number; signal?: AbortSignal } = {},
): Promise<LapisResponse<MutationRow>> {
  return transport.query<MutationRow>({
    baseUrl: cfg.lapisBaseUrl,
    endpoint: 'nucleotideMutations',
    body: { ...filters, minProportion: opts.minProportion ?? 0 },
    signal: opts.signal,
  });
}

/**
 * The largest window `fetchExactCoverage` will fan out over.
 *
 * One request per position, so this is a hard ceiling on how much a single
 * click can cost: 60 requests against a public instance that showed no
 * throttling at 12 but publishes `Retry-After`. Nothing in the product needs a
 * longer window -- the longest oligo the library carries is well under it --
 * and a 200 nt paste should be refused with a reason, not fanned out.
 */
export const MAX_EXACT_COVERAGE_POSITIONS = 60;

/**
 * Thrown when any position in the fan-out could not be measured.
 *
 * The fan-out is all-or-nothing on purpose. If three of twenty-two queries
 * fail, filling those three from the window denominator and presenting the
 * result as exact coverage would produce a chart that is measured in nineteen
 * places and inferred in three, labelled "exact" throughout -- strictly worse
 * than the inferred chart it replaced, because the label would now be wrong.
 * The positions that failed are named so the caller can say which they were.
 */
export class ExactCoverageError extends Error {
  readonly failedPositions: number[];

  constructor(failedPositions: number[], total: number) {
    super(
      `${failedPositions.length} of ${total} per-position coverage queries failed ` +
        `(positions ${failedPositions.join(', ')}). No exact coverage was applied.`,
    );
    this.name = 'ExactCoverageError';
    this.failedPositions = failedPositions;
  }
}

/**
 * Exact per-position coverage for one binding site: one `aggregated` query per
 * position, returning reference position -> number of sequences in scope with a
 * definite base call there.
 *
 * This is the opt-in path and nothing calls it automatically. The baseline
 * analysis is 3 + 4N queries whatever the oligo length; this adds one per
 * position on top, and the control that triggers it states that count before
 * the user commits to it.
 *
 * The query is `!(<pos>N)` -- the sequences that are *not* ambiguous at the
 * position, which is per LAPIS's own definition the position's `coverage`. The
 * plan wrote `<pos>N`, the complement, which counts the ambiguous ones and
 * needs `nScope` subtracted from it by a caller holding the right `nScope`.
 * Asking for the number we actually want removes that subtraction, and with it
 * the chance of pairing a count with the wrong scope total.
 *
 * Every request carries the caller's `signal` (Global Constraint 10). A
 * superseded fan-out is aborted by its caller; because `Promise.allSettled`
 * resolves either way, the caller must also check `signal.aborted` before
 * writing the result anywhere.
 */
export async function fetchExactCoverage(
  transport: LapisTransport,
  cfg: PathogenConfig,
  filters: Filters,
  window: WindowSpec,
  opts: { signal?: AbortSignal } = {},
): Promise<Map<number, number>> {
  const positions = window.positions;
  if (positions.length > MAX_EXACT_COVERAGE_POSITIONS) {
    throw new Error(
      `Exact per-base coverage is limited to ${MAX_EXACT_COVERAGE_POSITIONS} positions and this ` +
        `binding site has ${positions.length} positions, which would be ${positions.length} extra queries.`,
    );
  }

  const settled = await Promise.allSettled(
    positions.map((p) =>
      queryAggregated(transport, cfg, filters, {
        advancedQuery: `!(${ambiguityTerm(window, p)})`,
        ...(opts.signal ? { signal: opts.signal } : {}),
      }),
    ),
  );

  const coverage = new Map<number, number>();
  const failed: number[] = [];
  for (const [i, outcome] of settled.entries()) {
    const refPos = (positions[i] as { refPos: number }).refPos;
    if (outcome.status === 'rejected') {
      failed.push(refPos);
      continue;
    }
    coverage.set(
      refPos,
      outcome.value.data.reduce((total, row) => total + row.count, 0),
    );
  }

  if (failed.length > 0) throw new ExactCoverageError(failed, positions.length);
  return coverage;
}

export async function queryNucleotideInsertions(
  transport: LapisTransport,
  cfg: PathogenConfig,
  filters: Filters,
  opts: { signal?: AbortSignal } = {},
): Promise<LapisResponse<InsertionRow>> {
  return transport.query<InsertionRow>({
    baseUrl: cfg.lapisBaseUrl,
    endpoint: 'nucleotideInsertions',
    body: { ...filters },
    signal: opts.signal,
  });
}

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

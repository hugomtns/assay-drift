import type { BindingSite } from '../binding';
import type { ReferenceGenome } from '../reference';
import type { OligoRole } from '../oligo-input';
import type { LapisTransport } from '../lapis/transport';
import {
  queryAggregated, queryNucleotideInsertions, queryNucleotideMutations,
  type InsertionRow, type MutationRow,
} from '../lapis/endpoints';
import { guardResponseSize } from '../lapis/size-guard';
import { getPathogen, type PathogenId } from '../registry';
import { scopeToFilters, type Scope } from '../scope';
import {
  buildWindowSpec, fullCoverageQuery, mismatchWithCoverageQuery, type WindowSpec,
} from '../query';
import { buildAttribution, type Attribution } from './attribution';
import { computeDiagnostics, type Diagnostic } from './diagnostics';
import { insertionsInWindow, type WindowInsertion } from './insertions';
import { computeWindowMetrics, sumCounts, type WindowMetrics } from './metrics';
import { buildPositionProfile, type PositionStat } from './profile';
import { scoreSeverity, type Severity } from './severity';
import { buildTrend, type TrendSeries } from './trend';

export interface AnalysisOligo {
  id: string;
  name: string;
  role: OligoRole;
  sequence: string;
  site: BindingSite;
}

export interface OligoAnalysis {
  oligoId: string;
  name: string;
  role: OligoRole;
  sequence: string;
  site: BindingSite;
  window: WindowSpec;
  metrics: WindowMetrics;
  profile: PositionStat[];
  insertions: WindowInsertion[];
  trend: TrendSeries;
  lineage: Attribution;
  country: Attribution;
  severity: Severity;
  diagnostics: Diagnostic[];
}

export interface AnalysisResult {
  scope: Scope;
  pathogenId: PathogenId;
  generatedAt: string;
  dataVersion: string;
  nScope: number;
  oligos: OligoAnalysis[];
  queryCount: number;
  /**
   * Diagnostics that belong to the run rather than to any one binding site.
   *
   * `OligoAnalysis.diagnostics` describes one oligo's site and every message
   * there names that oligo, because `CaveatPanel` de-duplicates by `id` and
   * one oligo ends up speaking for the panel. The size of the shared mutations
   * payload is not a property of an oligo at all -- it is the same download
   * whichever oligos are being analysed -- so attaching it to one of them
   * would print a scope-wide fact under a name it has nothing to do with, and
   * attaching it to all of them would depend on de-duplication to undo the
   * copies. It lives here instead, and is empty for almost every run.
   */
  diagnostics: Diagnostic[];
}

export async function runAnalysis(input: {
  transport: LapisTransport;
  scope: Scope;
  oligos: AnalysisOligo[];
  reference: ReferenceGenome;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<AnalysisResult> {
  const { transport, scope, oligos, reference, signal } = input;
  const now = input.now ?? (() => new Date());
  const cfg = getPathogen(scope.pathogenId);
  const filters = scopeToFilters(scope, cfg);
  const opts = signal ? { signal } : {};
  let queryCount = 0;

  const windows = oligos.map((o) =>
    buildWindowSpec(o.site, o.sequence, reference, o.role, { segmented: cfg.segmented }),
  );

  const scopePromise = queryAggregated(transport, cfg, filters, { fields: [cfg.dateField], ...opts });
  const mutationsPromise = queryNucleotideMutations(transport, cfg, filters, { minProportion: 0, ...opts });
  const insertionsPromise = queryNucleotideInsertions(transport, cfg, filters, opts);
  queryCount += 3;

  const perOligoPromises = windows.map((w) => {
    const coverage = fullCoverageQuery(w);
    const mismatch = mismatchWithCoverageQuery(w);
    queryCount += 4;
    return Promise.all([
      queryAggregated(transport, cfg, filters, { fields: [cfg.dateField], advancedQuery: coverage, ...opts }),
      queryAggregated(transport, cfg, filters, { fields: [cfg.dateField], advancedQuery: mismatch, ...opts }),
      queryAggregated(transport, cfg, filters, { fields: [cfg.lineageField], advancedQuery: mismatch, ...opts }),
      queryAggregated(transport, cfg, filters, { fields: [cfg.countryField], advancedQuery: mismatch, ...opts }),
    ]);
  });

  const [scopeRes, mutationsRes, insertionsRes, perOligo] = await Promise.all([
    scopePromise, mutationsPromise, insertionsPromise, Promise.all(perOligoPromises),
  ]);

  const nScope = sumCounts(scopeRes.data);
  const mutationRows: MutationRow[] = mutationsRes.data;
  const insertionRows: InsertionRow[] = insertionsRes.data;

  /**
   * The guard warns; it never acts.
   *
   * Nothing below reacts to a large payload -- `minProportion` stays 0 and
   * every row that came back is used. Raising the floor would drop exactly the
   * low-frequency alleles the tool exists to surface, and would do it silently,
   * on the queries most likely to matter.
   *
   * `responseBytes` is undefined whenever the transport could not measure
   * (the fixture transport, any future transport that replays), and undefined
   * means unmeasured, not small.
   */
  const runDiagnostics: Diagnostic[] = [];
  const bytes = mutationsRes.responseBytes;
  if (bytes !== undefined) {
    const verdict = guardResponseSize(bytes, 'nucleotideMutations');
    if (!verdict.ok && verdict.message !== null) {
      runDiagnostics.push({ id: 'large-response', severity: 'info', message: verdict.message });
    }
  }

  const analyses: OligoAnalysis[] = oligos.map((o, i) => {
    const w = windows[i] as WindowSpec;
    const responses = perOligo[i];
    if (!responses) throw new Error(`Missing responses for oligo ${o.id}`);
    const [coverageRes, mismatchRes, lineageRes, countryRes] = responses;

    const metrics = computeWindowMetrics({
      nScope,
      nFullCoverage: sumCounts(coverageRes.data),
      nMismatch: sumCounts(mismatchRes.data),
    });
    const profile = buildPositionProfile(w, mutationRows, metrics.nFullCoverage);
    const trend = buildTrend({
      coverageRows: coverageRes.data, mismatchRows: mismatchRes.data,
      dateField: cfg.dateField, dateFrom: scope.dateFrom, dateTo: scope.dateTo,
    });
    const lineage = buildAttribution(lineageRes.data, cfg.lineageField);
    const country = buildAttribution(countryRes.data, cfg.countryField);

    return {
      oligoId: o.id, name: o.name, role: o.role, sequence: o.sequence, site: o.site,
      window: w, metrics, profile,
      insertions: insertionsInWindow(w, insertionRows, metrics.nFullCoverage),
      trend, lineage, country,
      severity: scoreSeverity({ role: o.role, metrics, profile }),
      diagnostics: computeDiagnostics({ oligoName: o.name, metrics, trend, country }),
    };
  });

  return {
    scope,
    pathogenId: scope.pathogenId,
    generatedAt: now().toISOString(),
    dataVersion: scopeRes.dataVersion,
    nScope,
    oligos: analyses,
    queryCount,
    diagnostics: runDiagnostics,
  };
}

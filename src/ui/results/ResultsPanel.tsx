import { useState } from 'react';
import type { PositionStat } from '../../core/analysis/profile';
import type { AnalysisResult, OligoAnalysis } from '../../core/analysis/run';
import type { LapisTransport } from '../../core/lapis/transport';
import { getPathogen, type PathogenConfig } from '../../core/registry';
import { scopeToFilters } from '../../core/scope';
import { CaveatPanel } from '../CaveatPanel';
import { AttributionTable } from './AttributionTable';
import { ExactCoverageToggle } from './ExactCoverageToggle';
import { ExportButtons } from './ExportButtons';
import { HeadlineCard } from './HeadlineCard';
import { InsertionNote } from './InsertionNote';
import { PositionProfile } from './PositionProfile';
import { SeverityBadge } from './SeverityBadge';
import { TrendChart } from './TrendChart';
import { formatCount } from '../format';

interface ResultsPanelProps {
  result: AnalysisResult;
  /**
   * The session transport, needed only by the opt-in exact-coverage control.
   *
   * Optional because the panel is a pure view of a finished analysis
   * everywhere else, and most tests render it without one. Absent, the control
   * is simply not offered -- a button that cannot issue its queries should not
   * be on screen advertising them.
   */
  transport?: LapisTransport;
}

interface OligoResultProps {
  analysis: OligoAnalysis;
  cfg: PathogenConfig;
  filters: Record<string, unknown>;
  transport: LapisTransport | undefined;
}

/**
 * One oligo's block, and the only stateful thing on this page.
 *
 * The state is the exact per-position coverage, if the user asked for it. It
 * lives here rather than in `PositionProfile` because `PositionProfile` draws
 * what it is given and gains nothing from knowing where the numbers came from;
 * feeding it a refined `profile` means the hatching, the `<title>` tooltips
 * and the hidden table's notes all stop saying "borrowed denominator" together,
 * with no second code path to keep in step.
 *
 * The caller keys this component on the run, so a re-run or a scope change
 * remounts it: the loaded coverage is dropped and `ExactCoverageToggle`'s
 * cleanup aborts anything still in flight. That is the reset -- there is no
 * effect here undoing state after the fact.
 */
function OligoResult({ analysis, cfg, filters, transport }: OligoResultProps) {
  const [exactProfile, setExactProfile] = useState<PositionStat[] | null>(null);
  const shown: OligoAnalysis =
    exactProfile === null ? analysis : { ...analysis, profile: exactProfile };

  return (
    <div className="flex flex-col gap-4 rounded border border-slate-300 p-4">
      <HeadlineCard analysis={shown} />
      <SeverityBadge severity={analysis.severity} role={analysis.role} />
      {transport !== undefined && (
        <ExactCoverageToggle
          analysis={analysis}
          transport={transport}
          cfg={cfg}
          filters={filters}
          onCoverage={setExactProfile}
        />
      )}
      <PositionProfile analysis={shown} />
      <TrendChart trend={analysis.trend} />
      {/*
        Every panel below is repeated once per oligo, so each is named with
        the oligo it belongs to. Without that a three-oligo result exposes
        six identically named regions and a landmark list that cannot be
        used to get anywhere.
      */}
      <div className="flex flex-wrap gap-6">
        <AttributionTable
          attribution={analysis.lineage}
          label={cfg.lineageLabel}
          oligoName={analysis.name}
        />
        <AttributionTable attribution={analysis.country} label="Country" oligoName={analysis.name} />
      </div>
      <InsertionNote
        insertions={analysis.insertions}
        denominator={analysis.metrics.nFullCoverage}
        oligoName={analysis.name}
      />
    </div>
  );
}

/**
 * Step 4 of the wizard: the answer.
 *
 * This component composes and does not draw. Every visual element below is its
 * own component with its own tests, and the reason is not tidiness: each one
 * carries a constraint that has to hold on its own (a percentage never without
 * its counts, a null rate never as a zero, an unassessable position never as a
 * conserved one). A single panel rendering all of it inline would let those
 * rules be satisfied by accident in one arrangement and quietly lost in the
 * next.
 *
 * `CaveatPanel` is rendered once, outside the per-oligo loop. The five fixed
 * caveats are properties of the data source, not of an oligo; printed three
 * times they would read as three separate warnings and be skimmed as boilerplate
 * the first time.
 *
 * The provenance line is not decoration either. `dataVersion` is what makes a
 * figure reproducible — the same query against a later snapshot is a different
 * answer, and without the version stamp a screenshot of this panel cannot be
 * checked against anything.
 */
export function ResultsPanel({ result, transport }: ResultsPanelProps) {
  const cfg = getPathogen(result.pathogenId);
  const filters = scopeToFilters(result.scope, cfg);

  return (
    <section aria-labelledby="results-panel-heading" className="flex flex-col gap-6">
      <h2 id="results-panel-heading" className="text-xl font-semibold">
        Step 4: What the sequences show
      </h2>

      <div role="table" aria-label="Assay summary" className="border-b border-slate-200">
        <div role="row" className="sr-only text-xs font-medium text-slate-600 sm:not-sr-only sm:grid sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(13rem,1.4fr)_minmax(16rem,1.8fr)_minmax(8rem,1fr)] sm:gap-x-3 sm:pb-2">
          <span role="columnheader">Oligo</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">Mismatch rate</span>
          <span role="columnheader">Coverage gap</span>
          <span role="columnheader">Severity</span>
        </div>
        {result.oligos.map((oligo) => (
          <div key={oligo.oligoId} role="row" className="grid gap-x-3 gap-y-1 border-t border-slate-200 py-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(13rem,1.4fr)_minmax(16rem,1.8fr)_minmax(8rem,1fr)] sm:items-center">
            <HeadlineCard analysis={oligo} summary />
            <div role="cell">
              <SeverityBadge severity={oligo.severity} role={oligo.role} compact />
            </div>
          </div>
        ))}
      </div>

      <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Sampled sequences are not infections. Sequences with ambiguous bases at this site are excluded from rates. An in-silico mismatch is not assay failure.
      </p>

      <CaveatPanel result={result} />

      <p className="text-sm text-slate-700">
        {`${formatCount(result.nScope)} ${cfg.label} sequences match this scope, collected ${result.scope.dateFrom} to ${result.scope.dateTo} inclusive. Data version ${result.dataVersion}, read ${result.generatedAt}, over ${formatCount(result.queryCount)} queries.`}
      </p>

      <ExportButtons result={result} />

      {result.oligos.map((oligo) => (
        <OligoResult
          // The generation stamp is part of the key so a re-run is a remount:
          // exact coverage loaded against the previous scope must not survive
          // into the next one, and the fan-out it started must be aborted.
          key={`${result.generatedAt}-${oligo.oligoId}`}
          analysis={oligo}
          cfg={cfg}
          filters={filters}
          transport={transport}
        />
      ))}
    </section>
  );
}

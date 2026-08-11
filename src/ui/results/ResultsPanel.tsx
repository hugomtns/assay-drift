import { getPathogen } from '../../core/registry';
import type { AnalysisResult } from '../../core/analysis/run';
import { CaveatPanel } from '../CaveatPanel';
import { AttributionTable } from './AttributionTable';
import { HeadlineCard } from './HeadlineCard';
import { InsertionNote } from './InsertionNote';
import { PositionProfile } from './PositionProfile';
import { SeverityBadge } from './SeverityBadge';
import { TrendChart } from './TrendChart';
import { formatCount } from './format';

interface ResultsPanelProps {
  result: AnalysisResult;
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
export function ResultsPanel({ result }: ResultsPanelProps) {
  const cfg = getPathogen(result.pathogenId);

  return (
    <section aria-labelledby="results-panel-heading" className="flex flex-col gap-6">
      <h2 id="results-panel-heading" className="text-xl font-semibold">
        Step 4: What the sequences show
      </h2>

      <p className="text-sm text-slate-700">
        {`${formatCount(result.nScope)} ${cfg.label} sequences match this scope, collected ${result.scope.dateFrom} to ${result.scope.dateTo} inclusive. Data version ${result.dataVersion}, read ${result.generatedAt}, over ${formatCount(result.queryCount)} queries.`}
      </p>

      {result.oligos.map((oligo) => (
        <div
          key={oligo.oligoId}
          className="flex flex-col gap-4 rounded border border-slate-300 p-4"
        >
          <HeadlineCard analysis={oligo} />
          <SeverityBadge severity={oligo.severity} role={oligo.role} />
          <PositionProfile analysis={oligo} />
          <TrendChart trend={oligo.trend} />
          <div className="flex flex-wrap gap-6">
            <AttributionTable attribution={oligo.lineage} label={cfg.lineageLabel} />
            <AttributionTable attribution={oligo.country} label="Country" />
          </div>
          <InsertionNote
            insertions={oligo.insertions}
            denominator={oligo.metrics.nFullCoverage}
          />
        </div>
      ))}

      <CaveatPanel result={result} />
    </section>
  );
}

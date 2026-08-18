import { formatCount } from '../core/format';
import type { AnalysisResult } from '../core/analysis/run';
import { getPathogen } from '../core/registry';
import type { Status } from '../state/store';
import { SEVERITY_LABELS } from './results/severity-labels';

/** The name of the live region, so tests and users can both find it. */
const REGION_LABEL = 'Analysis outcome';

/**
 * One oligo, in a sentence: which site, what the heuristic called it, and the
 * two counts behind that call.
 *
 * No percentage appears here, deliberately. Global Constraint 6 forbids a rate
 * without its N, and a spoken rate is the easiest place in the product to lose
 * the N -- so this says the counts and lets the reader look at the card for
 * the rate. `nFullCoverage === 0` is the branch that must never be spoken as
 * "0%" or as a bare dash.
 */
function describeOligo(oligo: AnalysisResult['oligos'][number]): string {
  const level = SEVERITY_LABELS[oligo.severity.level];
  const { nMismatch, nFullCoverage } = oligo.metrics;
  if (nFullCoverage === 0) {
    return `${oligo.name}: ${level}. No sequences could be assessed at this site.`;
  }
  return (
    `${oligo.name}: ${level}. ${formatCount(nMismatch)} of ` +
    `${formatCount(nFullCoverage)} assessable sequences carry a mismatch.`
  );
}

function summarise(result: AnalysisResult): string {
  const label = getPathogen(result.pathogenId).label;
  if (result.nScope === 0) {
    return `Analysis complete. No ${label} sequences match this scope.`;
  }
  const head = `Analysis complete. ${formatCount(result.nScope)} ${label} sequences match this scope.`;
  return [head, ...result.oligos.map(describeOligo)].join(' ');
}

interface AnalysisAnnouncerProps {
  status: Status;
  result: AnalysisResult | null;
}

/**
 * What a screen-reader user hears when a run finishes.
 *
 * Before this existed, pressing "Run analysis" produced a loading region that
 * said a query had started and then nothing at all: focus stayed on a button
 * that had been replaced, and the arrival of an entire results panel below was
 * silent. The loading and error states each already had a region; completion,
 * the one outcome the user actually asked for, did not.
 *
 * Two decisions, both following idioms this repo already established:
 *
 * - **Always mounted, text swapped in.** A live region inserted at the same
 *   instant as its text is frequently never announced at all. This component
 *   renders its `<p>` unconditionally and puts the empty string in it while
 *   there is nothing to say. It is also rendered as a *sibling* of the step
 *   content rather than inside it, so switching steps cannot unmount it.
 * - **`role="status"`, which already implies `aria-live="polite"`.** No
 *   redundant `aria-live` attribute. Polite rather than assertive because a
 *   result the user asked for and is waiting on is not an interruption; it
 *   should be spoken when the reader reaches a pause, not over the top of
 *   whatever they were reading.
 *
 * Visually hidden: the same information is on screen in the results panel, in
 * far more detail. Repeating it in the page would be noise for a sighted user
 * and would go stale the moment the panel changed shape.
 */
export function AnalysisAnnouncer({ status, result }: AnalysisAnnouncerProps) {
  const message = status === 'ready' && result !== null ? summarise(result) : '';
  return (
    <p role="status" aria-label={REGION_LABEL} className="sr-only">
      {message}
    </p>
  );
}

import type { SeverityLevel } from '../../core/analysis/severity';

/**
 * The four words, fixed by the project's copy rules. Not Low/Medium/High,
 * which reads as a measured quantity; not Pass/Fail, which is a verdict on an
 * assay this tool has never seen run. Each one names what the reader should
 * *do*, which is the only thing a heuristic over sequence counts is entitled
 * to suggest.
 *
 * They live in their own module rather than inside `SeverityBadge` because
 * `AnalysisAnnouncer` speaks the same verdict into a live region when a run
 * finishes, and two copies of these four words would be two things to keep
 * true. (A second export from `SeverityBadge.tsx` would also trip
 * `react-refresh/only-export-components`, which forgives literals but not
 * objects.)
 */
export const SEVERITY_LABELS: Readonly<Record<SeverityLevel, string>> = {
  green: 'Fine',
  amber: 'Watch',
  red: 'Act on',
  unknown: 'Not enough data',
};

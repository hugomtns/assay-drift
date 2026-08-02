/** Below this many assessable sequences, no headline percentage is shown. */
export const MIN_DENOMINATOR = 50;

/** Coverage gap above this fraction earns a visible warning. */
export const COVERAGE_GAP_WARN = 0.2;
/** Coverage gap above this fraction makes the estimate unusable. */
export const COVERAGE_GAP_UNUSABLE = 0.5;

export const AMBER_FRACTION = 0.01;
export const RED_FRACTION = 0.05;
/**
 * Score thresholds are deliberately low enough that position can override level.
 * The maximum achievable score for a window whose mismatch fraction is f is 6f
 * (weight 3 at the 3' terminus x deletion weight 2), so a red-by-score threshold
 * above 0.3 could never fire below RED_FRACTION and the 3' weighting would be
 * decorative. At 0.15, a 2.5% mismatch rate concentrated as a terminal 3'
 * deletion is rated red while a 4% rate spread mid-oligo stays amber -- which is
 * the whole point of weighting by position.
 */
export const AMBER_SCORE = 0.03;
export const RED_SCORE = 0.15;

/** Deletions are weighted more heavily than substitutions in the heuristic. */
export const DELETION_WEIGHT = 2;
/** Distance from the 3' end (0 = terminal base) treated as critical, then near-critical. */
export const THREE_PRIME_CRITICAL = 2;
export const THREE_PRIME_NEAR = 5;

export const TOP_COUNTRY_SHARE_WARN = 0.6;
/** How many trailing buckets are checked for deposition lag. */
export const DEPOSITION_LAG_BUCKETS = 4;
/** A trailing bucket below this ratio of the historical median counts as thin. */
export const DEPOSITION_LAG_RATIO = 0.5;

export const MAX_ATTRIBUTION_ROWS = 10;

export const UNIT_OF_ANALYSIS =
  'Percentages are over sequences in scope that have a definite base call at every position of the binding site. Sequences with an ambiguous base (N) anywhere in the site are excluded and reported separately as the coverage gap.';

export const SEVERITY_DISCLAIMER =
  'The severity indicator is a heuristic based on mismatch count, mismatch frequency and proximity to the 3′ end. It is not a thermodynamic model and not a statement about assay performance.';

export const REGULATORY_STATEMENT =
  'Assay Drift Watch is a research and educational tool, not a diagnostic device. It is not for clinical decision-making, and an in-silico mismatch is not the same as assay failure.';

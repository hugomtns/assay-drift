import type { OligoRole } from '../oligo-input';
import type { WindowMetrics } from './metrics';
import type { PositionStat } from './profile';
import {
  AMBER_FRACTION, AMBER_SCORE, COVERAGE_GAP_UNUSABLE, DELETION_WEIGHT,
  RED_FRACTION, RED_SCORE, THREE_PRIME_CRITICAL, THREE_PRIME_NEAR,
} from './constants';

export type SeverityLevel = 'green' | 'amber' | 'red' | 'unknown';

export interface Severity {
  level: SeverityLevel;
  score: number;
  reasons: string[];
}

export function positionWeight(role: OligoRole, distanceFrom3Prime: number): number {
  if (role === 'probe') return 1;
  if (distanceFrom3Prime <= THREE_PRIME_CRITICAL) return 3;
  if (distanceFrom3Prime <= THREE_PRIME_NEAR) return 2;
  return 1;
}

export function scoreSeverity(input: {
  role: OligoRole;
  metrics: WindowMetrics;
  profile: PositionStat[];
}): Severity {
  const { role, metrics, profile } = input;
  const reasons: string[] = [];

  let score = 0;
  for (const p of profile) {
    const denominator = p.effectiveDenominator;
    if (denominator === 0) continue;
    const substitutionFraction = p.substitutionCount / denominator;
    const deletionFraction = p.deletionCount / denominator;
    score += positionWeight(role, p.distanceFrom3Prime) *
      (substitutionFraction + DELETION_WEIGHT * deletionFraction);
  }

  if (!metrics.sufficientData) {
    reasons.push(
      `Too few assessable sequences (n = ${metrics.nFullCoverage}) to report a rate.`,
    );
    return { level: 'unknown', score, reasons };
  }
  if (metrics.coverageGapFraction > COVERAGE_GAP_UNUSABLE) {
    reasons.push(
      `${Math.round(metrics.coverageGapFraction * 100)}% of sequences in scope lack coverage across this site, so the rate is not interpretable.`,
    );
    return { level: 'unknown', score, reasons };
  }

  if (role === 'probe') {
    reasons.push('Probe positions are weighted uniformly; the 3′ weighting applies to primers only.');
  }

  const near3Prime = profile.filter(
    (p) => role !== 'probe' && p.distanceFrom3Prime <= THREE_PRIME_CRITICAL && p.mismatchFraction > 0.01,
  );
  if (near3Prime.length > 0) {
    reasons.push(
      `${near3Prime.length} mismatch position(s) fall within the terminal three bases of the 3′ end.`,
    );
  }

  const deletions = profile.filter((p) => p.deletionCount > 0);
  if (deletions.length > 0) {
    reasons.push(
      `Deletions observed at ${deletions.length} position(s); deletions are weighted ${DELETION_WEIGHT}× substitutions.`,
    );
  }

  if (profile.some((p) => p.coverageIsInferred)) {
    reasons.push(
      'Per-position coverage was not reported at some positions (no mutation observed there); the window denominator was used instead.',
    );
  }

  const fraction = metrics.mismatchFraction ?? 0;
  let level: SeverityLevel;
  if (fraction >= RED_FRACTION || score >= RED_SCORE) level = 'red';
  else if (fraction >= AMBER_FRACTION || score >= AMBER_SCORE) level = 'amber';
  else level = 'green';

  return { level, score, reasons };
}

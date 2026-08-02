import { describe, it, expect } from 'vitest';
import { positionWeight, scoreSeverity } from './severity';
import { computeWindowMetrics } from './metrics';
import type { PositionStat } from './profile';

const stat = (over: Partial<PositionStat>): PositionStat => ({
  refPos: 100, oligoIndex: 0, oligoBase: 'A', plusStrandBase: 'A', refBase: 'A',
  distanceFrom3Prime: 10, coverage: 1000, coverageIsInferred: false,
  effectiveDenominator: 1000, mismatchCount: 0, substitutionCount: 0, deletionCount: 0,
  mismatchFraction: 0, alleles: [], referenceIsAmbiguous: false, ...over,
});

describe('positionWeight', () => {
  it('weights the terminal 3prime bases most heavily for primers', () => {
    expect(positionWeight('forward', 0)).toBe(3);
    expect(positionWeight('forward', 2)).toBe(3);
    expect(positionWeight('reverse', 3)).toBe(2);
    expect(positionWeight('forward', 5)).toBe(2);
    expect(positionWeight('forward', 6)).toBe(1);
  });
  it('weights probe positions uniformly', () => {
    expect(positionWeight('probe', 0)).toBe(1);
    expect(positionWeight('probe', 20)).toBe(1);
  });
});

describe('scoreSeverity', () => {
  const metrics = (fraction: number) =>
    computeWindowMetrics({
      nScope: 1000, nFullCoverage: 1000, nMismatch: Math.round(fraction * 1000),
    });

  it('is green for a conserved site', () => {
    const s = scoreSeverity({ role: 'forward', metrics: metrics(0.0001), profile: [stat({})] });
    expect(s.level).toBe('green');
    expect(s.score).toBeCloseTo(0, 6);
  });

  it('is red above the headline threshold', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.96),
      profile: [stat({ distanceFrom3Prime: 0, deletionCount: 960, mismatchCount: 960, mismatchFraction: 0.96 })],
    });
    expect(s.level).toBe('red');
    expect(s.reasons.join(' ')).toMatch(/deletion/i);
  });

  it('escalates to red on a 3prime terminal deletion below the headline threshold', () => {
    // 3% of sequences carry a deletion at the terminal 3' base.
    // Headline 3% would be amber; score = weight 3 x deletion weight 2 x 0.03 = 0.18 -> red.
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.03),
      profile: [stat({
        distanceFrom3Prime: 0, deletionCount: 30, mismatchCount: 30, mismatchFraction: 0.03,
      })],
    });
    expect(s.score).toBeCloseTo(0.18, 6);
    expect(s.level).toBe('red');
    expect(s.reasons.join(' ')).toMatch(/3′|3'/);
  });

  it('leaves the same frequency amber when it sits mid-oligo', () => {
    // Identical 3% rate, but 12 bases from the 3' end and a substitution:
    // score = weight 1 x 0.03 = 0.03, which is amber, not red.
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.03),
      profile: [stat({
        distanceFrom3Prime: 12, substitutionCount: 30, mismatchCount: 30, mismatchFraction: 0.03,
      })],
    });
    expect(s.score).toBeCloseTo(0.03, 6);
    expect(s.level).toBe('amber');
  });

  it('is amber in the middle band', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.02),
      profile: [stat({ distanceFrom3Prime: 12, substitutionCount: 20, mismatchCount: 20, mismatchFraction: 0.02 })],
    });
    expect(s.level).toBe('amber');
  });

  it('is unknown when the denominator is too small', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: computeWindowMetrics({ nScope: 40, nFullCoverage: 30, nMismatch: 20 }),
      profile: [stat({})],
    });
    expect(s.level).toBe('unknown');
    expect(s.reasons.join(' ')).toMatch(/too few/i);
  });

  it('is unknown when most sequences could not be assessed', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: computeWindowMetrics({ nScope: 10000, nFullCoverage: 3000, nMismatch: 10 }),
      profile: [stat({})],
    });
    expect(s.level).toBe('unknown');
    expect(s.reasons.join(' ')).toMatch(/coverage/i);
  });

  it('notes when a position profile relied on inferred coverage', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.001),
      profile: [stat({ coverageIsInferred: true })],
    });
    expect(s.reasons.join(' ')).toMatch(/inferred|not reported/i);
  });
});

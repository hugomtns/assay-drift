import { describe, expect, it } from 'vitest';
import type { PositionStat } from '../../core/analysis/profile';
import { noteFor, segmentsFor, unattributed } from './position-profile-view-model';

const stat = (over: Partial<PositionStat>): PositionStat => ({ refPos: 1, oligoIndex: 0, oligoBase: 'A', plusStrandBase: 'A', refBase: 'A', distanceFrom3Prime: 1, coverage: 100, coverageIsInferred: false, effectiveDenominator: 100, mismatchCount: 10, substitutionCount: 3, deletionCount: 2, mismatchFraction: 0.1, alleles: [], referenceIsAmbiguous: false, ...over });
describe('position-profile view model', () => {
  it('derives a complete stacked bar including unattributed mismatches', () => {
    expect(segmentsFor(stat({}), 80).reduce((sum, segment) => sum + segment.height, 0)).toBeCloseTo(8);
    expect(unattributed(stat({}))).toBe(true);
  });
  it('never assigns a rate note to an ambiguous reference base', () => {
    expect(noteFor(stat({ referenceIsAmbiguous: true }))).toMatch(/not assessable/i);
  });
});

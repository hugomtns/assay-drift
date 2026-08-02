import { describe, it, expect } from 'vitest';
import { PATHOGENS, getPathogen } from './registry';

describe('PATHOGENS', () => {
  it('carries the three v1 pathogens', () => {
    expect(Object.keys(PATHOGENS).sort()).toEqual(['h3n2', 'h5n1', 'sars-cov-2']);
  });

  it('uses the verified SARS-CoV-2 instance and date parameters', () => {
    const p = getPathogen('sars-cov-2');
    expect(p.lapisBaseUrl).toBe('https://lapis.cov-spectrum.org/open/v2');
    expect(p.segmented).toBe(false);
    expect(p.dateField).toBe('date');
    expect(p.dateFromParam).toBe('dateFrom');
    expect(p.dateToParam).toBe('dateTo');
    expect(p.lineageField).toBe('pangoLineage');
  });

  it('uses the range-bound date parameters on the influenza instances', () => {
    for (const id of ['h5n1', 'h3n2'] as const) {
      const p = getPathogen(id);
      expect(p.segmented).toBe(true);
      expect(p.dateField).toBe('sampleCollectionDateRangeLower');
      expect(p.dateFromParam).toBe('sampleCollectionDateRangeLowerFrom');
      expect(p.dateToParam).toBe('sampleCollectionDateRangeUpperTo');
    }
  });

  it('labels influenza segments by gene product', () => {
    expect(getPathogen('h5n1').segmentLabels.seg4).toMatch(/HA/);
    expect(getPathogen('h3n2').segmentLabels.seg6).toMatch(/NA/);
  });

  it('uses the correct lineage field per instance', () => {
    expect(getPathogen('h5n1').lineageField).toBe('clade');
    expect(getPathogen('h3n2').lineageField).toBe('cladeHA');
  });

  it('throws on an unknown id', () => {
    expect(() => getPathogen('ebola' as never)).toThrow(/ebola/);
  });
});

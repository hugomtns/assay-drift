import { describe, it, expect } from 'vitest';
import { scopeToFilters, type Scope } from './scope';
import { getPathogen } from './registry';

const base: Scope = {
  pathogenId: 'sars-cov-2', dateFrom: '2021-02-01', dateTo: '2021-03-01',
  countries: ['United Kingdom'], lineages: [],
};

describe('scopeToFilters', () => {
  it('maps dates onto the instance-specific parameter names', () => {
    expect(scopeToFilters(base, getPathogen('sars-cov-2'))).toEqual({
      dateFrom: '2021-02-01', dateTo: '2021-03-01', country: ['United Kingdom'],
    });
  });

  it('uses range-bound parameters for influenza', () => {
    const flu: Scope = { ...base, pathogenId: 'h3n2', countries: [] };
    expect(scopeToFilters(flu, getPathogen('h3n2'))).toEqual({
      sampleCollectionDateRangeLowerFrom: '2021-02-01',
      sampleCollectionDateRangeUpperTo: '2021-03-01',
    });
  });

  it('omits empty country and lineage lists rather than sending empty arrays', () => {
    const empty: Scope = { ...base, countries: [], lineages: [] };
    expect(scopeToFilters(empty, getPathogen('sars-cov-2'))).not.toHaveProperty('country');
    expect(scopeToFilters(empty, getPathogen('sars-cov-2'))).not.toHaveProperty('pangoLineage');
  });

  it('includes lineages under the instance-specific field name', () => {
    const withLineage: Scope = { ...base, pathogenId: 'h3n2', lineages: ['J.2'] };
    expect(scopeToFilters(withLineage, getPathogen('h3n2'))).toMatchObject({ cladeHA: ['J.2'] });
  });
});

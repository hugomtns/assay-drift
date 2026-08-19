import { describe, expect, it } from 'vitest';
import { mergeSelection, optionValues, scopeValidation } from './scope-view-model';

describe('scope view model', () => {
  it('sorts distinct non-empty metadata options', () => {
    expect(optionValues([{ count: 1, country: 'Zambia' }, { count: 1, country: 'Austria' }, { count: 1, country: 'Austria' }, { count: 1, country: null }], 'country')).toEqual(['Austria', 'Zambia']);
  });
  it('retains selected values while marking only loaded-list misses', () => {
    expect(mergeSelection(['Germany'], ['Germany', 'germany'])).toEqual({ options: ['Germany'], unmatched: ['germany'] });
    expect(mergeSelection(null, ['Germany'])).toEqual({ options: ['Germany'], unmatched: [] });
  });
  it('accepts only complete, non-inverted date ranges', () => {
    expect(scopeValidation({ pathogenId: 'sars-cov-2', dateFrom: '', dateTo: '2026-01-01', countries: [], lineages: [] }).canRun).toBe(false);
    expect(scopeValidation({ pathogenId: 'sars-cov-2', dateFrom: '2026-02-01', dateTo: '2026-01-01', countries: [], lineages: [] }).inverted).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';

const reset = () => { useAppStore.getState().reset(); };

describe('app store', () => {
  beforeEach(reset);

  it('starts on the input step with SARS-CoV-2 selected', () => {
    const s = useAppStore.getState();
    expect(s.step).toBe('input');
    expect(s.pathogenId).toBe('sars-cov-2');
    expect(s.status).toBe('idle');
  });

  it('defaults the scope to the pathogen window ending today', () => {
    const { scope } = useAppStore.getState();
    expect(scope.dateTo >= scope.dateFrom).toBe(true);
    expect(scope.countries).toEqual([]);
  });

  it('clears resolutions and results when the pathogen changes', () => {
    const s = () => useAppStore.getState();
    s().setOligos([{ id: 'o1', name: 'x', role: 'forward', sequence: 'ACGTACGTACGTACGT' }]);
    s().chooseSite('o1', { segment: 'main', strand: 'plus', start: 1, end: 16, mismatches: 0, mismatchOligoIndexes: [] });
    s().setPathogen('h3n2');
    expect(s().chosenSites).toEqual({});
    expect(s().result).toBeNull();
    expect(s().step).toBe('input');
  });

  it('records a role override', () => {
    const s = () => useAppStore.getState();
    s().setOligos([{ id: 'o1', name: 'x', role: null, sequence: 'ACGTACGTACGTACGT' }]);
    s().setRole('o1', 'probe');
    expect(s().roles['o1']).toBe('probe');
  });

  it('moves through the analysis lifecycle', () => {
    const s = () => useAppStore.getState();
    s().startAnalysis();
    expect(s().status).toBe('loading');
    s().analysisFailed('LAPIS 400: bad query');
    expect(s().status).toBe('error');
    expect(s().error).toMatch(/bad query/);
    s().startAnalysis();
    expect(s().error).toBeNull();
  });
});

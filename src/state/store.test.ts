import { describe, it, expect, beforeEach } from 'vitest';
import { sampleResult } from '../core/analysis/test-fixtures';
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

  // `chooseSite` is a merge with no removal action, so a site the user picked
  // and then retracted stays in `chosenSites` forever. `commitSites` is the
  // one write that can shrink the map: it replaces it wholesale with exactly
  // the set the user confirmed, which is what the analysis assembly reads.
  it('replaces rather than merges chosenSites on commitSites', () => {
    const s = () => useAppStore.getState();
    const site = (start: number, end: number) => ({
      segment: 'main', strand: 'plus' as const, start, end, mismatches: 0, mismatchOligoIndexes: [],
    });
    s().setOligos([
      { id: 'o1', name: 'x', role: 'forward', sequence: 'ACGTACGTACGTACGT' },
      { id: 'o2', name: 'y', role: 'reverse', sequence: 'TTTTACGTACGTACGT' },
    ]);
    s().chooseSite('o1', site(1, 16));
    s().chooseSite('o2', site(101, 116));
    expect(Object.keys(s().chosenSites).sort()).toEqual(['o1', 'o2']);

    s().commitSites({ o2: site(101, 116) });

    expect(Object.keys(s().chosenSites)).toEqual(['o2']);
    expect(s().chosenSites['o1']).toBeUndefined();
    expect(s().chosenSites['o2']).toMatchObject({ start: 101, end: 116 });
  });

  it('clears chosenSites entirely when commitSites is given nothing', () => {
    const s = () => useAppStore.getState();
    s().chooseSite('o1', {
      segment: 'main', strand: 'plus', start: 1, end: 16, mismatches: 0, mismatchOligoIndexes: [],
    });
    s().commitSites({});
    expect(s().chosenSites).toEqual({});
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

  it('invalidates a result when oligos, binding sites, or scope change', () => {
    const s = () => useAppStore.getState();
    const site = { segment: 'main' as const, strand: 'plus' as const, start: 1, end: 16, mismatches: 0, mismatchOligoIndexes: [] };

    s().analysisSucceeded(sampleResult);
    s().setOligos([{ id: 'o1', name: 'x', role: 'forward', sequence: 'ACGTACGTACGTACGT' }]);
    expect(s().result).toBeNull();
    expect(s().chosenSites).toEqual({});

    s().analysisSucceeded(sampleResult);
    s().commitSites({ o1: site });
    expect(s().result).toBeNull();

    s().analysisSucceeded(sampleResult);
    s().setScope({ countries: ['Germany'] });
    expect(s().result).toBeNull();
  });
});

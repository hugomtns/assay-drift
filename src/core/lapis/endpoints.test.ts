import { describe, it, expect } from 'vitest';
import {
  ExactCoverageError,
  fetchExactCoverage,
  MAX_EXACT_COVERAGE_POSITIONS,
  queryAggregated,
  queryNucleotideMutations,
  queryNucleotideInsertions,
} from './endpoints';
import { findBindingSites } from '../binding';
import { buildWindowSpec } from '../query';
import { loadReference } from '../../data/references';
import { getPathogen } from '../registry';
import type { LapisRequest, LapisTransport } from './transport';

const recorder = () => {
  const seen: LapisRequest[] = [];
  const transport: LapisTransport = {
    async query(req) {
      seen.push(req);
      return { data: [], dataVersion: 'v', requestId: 'r' };
    },
  };
  return { seen, transport };
};

describe('queryAggregated', () => {
  it('targets the pathogen base url and merges filters, fields and advancedQuery', async () => {
    const { seen, transport } = recorder();
    await queryAggregated(
      transport,
      getPathogen('sars-cov-2'),
      { dateFrom: '2021-02-01', country: ['United Kingdom'] },
      { fields: ['date'], advancedQuery: '21765' },
    );
    expect(seen[0]).toMatchObject({
      baseUrl: 'https://lapis.cov-spectrum.org/open/v2',
      endpoint: 'aggregated',
      body: {
        dateFrom: '2021-02-01',
        country: ['United Kingdom'],
        fields: ['date'],
        advancedQuery: '21765',
      },
    });
  });

  it('omits fields and advancedQuery when not supplied', async () => {
    const { seen, transport } = recorder();
    await queryAggregated(transport, getPathogen('h3n2'), {});
    expect(seen[0]!.body).not.toHaveProperty('fields');
    expect(seen[0]!.body).not.toHaveProperty('advancedQuery');
  });
});

describe('queryNucleotideMutations', () => {
  it('defaults minProportion to 0 so rare mismatches are not hidden', async () => {
    const { seen, transport } = recorder();
    await queryNucleotideMutations(transport, getPathogen('sars-cov-2'), {});
    expect(seen[0]!.endpoint).toBe('nucleotideMutations');
    expect(seen[0]!.body).toMatchObject({ minProportion: 0 });
  });
});

describe('queryNucleotideInsertions', () => {
  it('sends no minProportion because the endpoint has no coverage concept', async () => {
    const { seen, transport } = recorder();
    await queryNucleotideInsertions(transport, getPathogen('h5n1'), {});
    expect(seen[0]!.endpoint).toBe('nucleotideInsertions');
    expect(seen[0]!.body).not.toHaveProperty('minProportion');
  });
});

describe('abort signals', () => {
  it('are forwarded to the transport', async () => {
    const { seen, transport } = recorder();
    const signal = new AbortController().signal;
    await queryAggregated(transport, getPathogen('h5n1'), {}, { signal });
    expect(seen[0]!.signal).toBe(signal);
  });
});

/**
 * The opt-in per-position path. One `aggregated` query per position, so a
 * 22 nt oligo is 22 extra requests on top of the analysis's 3 + 4N -- which is
 * why nothing calls this without the user asking for it.
 */
describe('fetchExactCoverage', () => {
  const reference = loadReference('sars-cov-2');
  /** Sliced from the bundled reference, never typed (Global Constraint 2). */
  const sequence = (reference.segments[0] as { sequence: string }).sequence.slice(21764, 21786);
  const site = findBindingSites(sequence, reference)[0]!;
  const window = buildWindowSpec(site, sequence, reference, 'forward', { segmented: false });

  const counting = (countFor: (query: string) => number) => {
    const seen: LapisRequest[] = [];
    const transport: LapisTransport = {
      async query(req) {
        seen.push(req);
        const q = req.body['advancedQuery'] as string;
        return { data: [{ count: countFor(q) }], dataVersion: 'v', requestId: 'r' } as never;
      },
    };
    return { seen, transport };
  };

  it('issues exactly one aggregated query per position', async () => {
    const { seen, transport } = counting(() => 100);
    await fetchExactCoverage(transport, getPathogen('sars-cov-2'), {}, window);
    expect(window.positions).toHaveLength(22);
    expect(seen).toHaveLength(22);
    expect(seen.every((r) => r.endpoint === 'aggregated')).toBe(true);
  });

  it('asks for the sequences with a definite call at the position, not the ambiguous ones', async () => {
    const { seen, transport } = counting(() => 100);
    await fetchExactCoverage(transport, getPathogen('sars-cov-2'), {}, window);
    // `!(21765N)` is the count we want -- coverage itself. `21765N` would be
    // its complement and would need nScope subtracted from it.
    expect(seen[0]!.body['advancedQuery']).toBe('!(21765N)');
  });

  it('carries the scope filters into every query', async () => {
    const { seen, transport } = counting(() => 100);
    await fetchExactCoverage(
      transport, getPathogen('sars-cov-2'), { dateFrom: '2021-02-01' }, window,
    );
    expect(seen.every((r) => r.body['dateFrom'] === '2021-02-01')).toBe(true);
  });

  it('returns a map from reference position to the summed count', async () => {
    const { transport } = counting((q) => (q === '!(21765N)' ? 900 : 800));
    const map = await fetchExactCoverage(transport, getPathogen('sars-cov-2'), {}, window);
    expect(map.size).toBe(22);
    expect(map.get(21765)).toBe(900);
    expect(map.get(21766)).toBe(800);
  });

  it('forwards the abort signal to every one of its queries', async () => {
    const { seen, transport } = counting(() => 100);
    const signal = new AbortController().signal;
    await fetchExactCoverage(transport, getPathogen('sars-cov-2'), {}, window, { signal });
    expect(seen.every((r) => r.signal === signal)).toBe(true);
  });

  it('refuses a window longer than the cap rather than issuing the queries', async () => {
    const { seen, transport } = counting(() => 100);
    const long = {
      ...window,
      positions: Array.from({ length: MAX_EXACT_COVERAGE_POSITIONS + 1 }, (_, i) => ({
        ...window.positions[0]!,
        refPos: 1000 + i,
      })),
    };
    await expect(
      fetchExactCoverage(transport, getPathogen('sars-cov-2'), {}, long),
    ).rejects.toThrow(/61 positions/);
    expect(seen).toHaveLength(0);
  });

  /**
   * Partial failure must never become a number. Filling the gaps with the
   * window denominator and presenting the result as exact is the one outcome
   * worse than not offering the feature.
   */
  it('rejects with the positions that could not be measured, and returns nothing', async () => {
    const failing: LapisTransport = {
      async query(req) {
        const q = req.body['advancedQuery'] as string;
        if (q === '!(21767N)' || q === '!(21770N)') throw new Error('HTTP 500');
        return { data: [{ count: 900 }], dataVersion: 'v', requestId: 'r' } as never;
      },
    };
    const error = await fetchExactCoverage(
      failing, getPathogen('sars-cov-2'), {}, window,
    ).then(() => null, (e: unknown) => e as ExactCoverageError);
    expect(error).toBeInstanceOf(ExactCoverageError);
    expect(error!.failedPositions).toEqual([21767, 21770]);
    expect(error!.message).toContain('2 of 22');
  });

  it('qualifies the position with the segment on a segmented genome', async () => {
    const h5n1 = loadReference('h5n1');
    const seg4 = h5n1.segments.find((s) => s.name === 'seg4')!;
    const seq = seg4.sequence.slice(99, 121);
    const s = findBindingSites(seq, h5n1)[0]!;
    const w = buildWindowSpec(s, seq, h5n1, 'forward', { segmented: true });
    const { seen, transport } = counting(() => 100);
    await fetchExactCoverage(transport, getPathogen('h5n1'), {}, w);
    expect(seen[0]!.body['advancedQuery']).toBe('!(seg4:100N)');
  });
});

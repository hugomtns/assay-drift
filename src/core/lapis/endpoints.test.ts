import { describe, it, expect } from 'vitest';
import { queryAggregated, queryNucleotideMutations, queryNucleotideInsertions } from './endpoints';
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

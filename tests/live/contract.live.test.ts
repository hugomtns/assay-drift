import { describe, it, expect } from 'vitest';
import { createFetchTransport } from '../../src/core/lapis/fetch-transport';
import { queryAggregated, queryNucleotideMutations } from '../../src/core/lapis/endpoints';
import { getPathogen, PATHOGENS } from '../../src/core/registry';
import { loadReference } from '../../src/data/references';

const transport = createFetchTransport();

describe('LAPIS contract (live)', () => {
  it.each(Object.values(PATHOGENS))('$id answers an aggregated query', async (cfg) => {
    const res = await queryAggregated(transport, cfg, {});
    expect(res.data[0]!.count).toBeGreaterThan(0);
  }, 60_000);

  it.each(Object.values(PATHOGENS))('$id date parameters are still valid', async (cfg) => {
    const res = await queryAggregated(transport, cfg, {
      [cfg.dateFromParam]: '2024-01-01',
      [cfg.dateToParam]: '2024-06-30',
    });
    expect(res.data[0]!.count).toBeGreaterThan(0);
  }, 60_000);

  it.each(Object.values(PATHOGENS))('$id groups by its date field', async (cfg) => {
    const res = await queryAggregated(
      transport, cfg,
      { [cfg.dateFromParam]: '2024-01-01', [cfg.dateToParam]: '2024-01-10' },
      { fields: [cfg.dateField] },
    );
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty(cfg.dateField);
  }, 60_000);

  it.each(Object.values(PATHOGENS))('$id bundled reference still matches the instance', async (cfg) => {
    const res = await fetch(`${cfg.lapisBaseUrl}/sample/referenceGenome`);
    const body = (await res.json()) as { nucleotideSequences: { name: string; sequence: string }[] };
    const bundled = loadReference(cfg.id);
    expect(body.nucleotideSequences.map((s) => `${s.name}:${s.sequence.length}`)).toEqual(
      bundled.segments.map((s) => `${s.name}:${s.sequence.length}`),
    );
  }, 60_000);

  it('still reports deletions in-band with per-position coverage', async () => {
    const cfg = getPathogen('sars-cov-2');
    const res = await queryNucleotideMutations(
      transport, cfg,
      { country: ['United Kingdom'], dateFrom: '2021-02-01', dateTo: '2021-03-01' },
      { minProportion: 0.5 },
    );
    const deletion = res.data.find((r) => r.position === 21765 && r.mutationTo === '-');
    expect(deletion).toBeDefined();
    expect(deletion!.coverage).toBeGreaterThan(deletion!.count);
    expect(deletion!.proportion).toBeCloseTo(deletion!.count / deletion!.coverage, 6);
  }, 120_000);

  it('still supports boolean operators in advancedQuery', async () => {
    const cfg = getPathogen('sars-cov-2');
    const filters = { country: ['United Kingdom'], dateFrom: '2021-02-01', dateTo: '2021-03-01' };
    const plain = await queryAggregated(transport, cfg, filters, { advancedQuery: '21765 | 21766' });
    const deMorgan = await queryAggregated(transport, cfg, filters, {
      advancedQuery: '!(!21765 & !21766)',
    });
    expect(plain.data[0]!.count).toBe(deMorgan.data[0]!.count);
  }, 120_000);
});

/**
 * Records the exact LAPIS responses the golden tests assert on.
 * Run: npx tsx scripts/record-fixtures.ts
 *
 * Re-run only deliberately. Re-recording is how a genuine upstream data change
 * enters the test suite, so the resulting diff must be reviewed by a human.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPathogen } from '../src/core/registry.js';
import { createFetchTransport } from '../src/core/lapis/fetch-transport.js';
import type { LapisRequest } from '../src/core/lapis/transport.js';
import type { FixtureRecord } from '../src/core/lapis/fixture-transport.js';

const OUT = join(process.cwd(), 'tests', 'fixtures');
const transport = createFetchTransport();

const window = (from: number, to: number, qualifier: string | null): { mismatch: string; coverage: string } => {
  const label = (p: number) => (qualifier ? `${qualifier}:${p}` : `${p}`);
  const positions = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const mism = positions.map((p) => label(p)).join(' | ');
  const ambi = positions.map((p) => `${label(p)}N`).join(' | ');
  return { mismatch: `(${mism}) & !(${ambi})`, coverage: `!(${ambi})` };
};

interface Case {
  name: string;
  requests: LapisRequest[];
}

const sc2 = getPathogen('sars-cov-2').lapisBaseUrl;
const h3n2 = getPathogen('h3n2').lapisBaseUrl;
const alpha = window(21765, 21786, null);
const control = window(15784, 15805, null);
const flu = window(600, 621, 'seg4');

const sc2Filters = (dateFrom: string, dateTo: string) => ({
  country: ['United Kingdom'], dateFrom, dateTo,
});
const fluFilters = (from: string, to: string) => ({
  sampleCollectionDateRangeLowerFrom: from, sampleCollectionDateRangeUpperTo: to,
});

const agg = (baseUrl: string, body: Record<string, unknown>): LapisRequest => ({
  baseUrl, endpoint: 'aggregated', body,
});

const CASES: Case[] = [
  {
    name: 'g1-alpha-2020-09',
    requests: [
      agg(sc2, sc2Filters('2020-09-01', '2020-10-01')),
      agg(sc2, { ...sc2Filters('2020-09-01', '2020-10-01'), advancedQuery: alpha.coverage }),
      agg(sc2, { ...sc2Filters('2020-09-01', '2020-10-01'), advancedQuery: alpha.mismatch }),
    ],
  },
  {
    name: 'g1-alpha-2021-02',
    requests: [
      agg(sc2, sc2Filters('2021-02-01', '2021-03-01')),
      agg(sc2, { ...sc2Filters('2021-02-01', '2021-03-01'), advancedQuery: alpha.coverage }),
      agg(sc2, { ...sc2Filters('2021-02-01', '2021-03-01'), advancedQuery: alpha.mismatch }),
      {
        baseUrl: sc2,
        endpoint: 'nucleotideMutations',
        body: { ...sc2Filters('2021-02-01', '2021-03-01'), minProportion: 0.001 },
      },
      { baseUrl: sc2, endpoint: 'nucleotideInsertions', body: sc2Filters('2021-02-01', '2021-03-01') },
    ],
  },
  {
    name: 'g2-h3n2-2022',
    requests: [
      agg(h3n2, fluFilters('2022-01-01', '2022-12-31')),
      agg(h3n2, { ...fluFilters('2022-01-01', '2022-12-31'), advancedQuery: flu.coverage }),
      agg(h3n2, { ...fluFilters('2022-01-01', '2022-12-31'), advancedQuery: flu.mismatch }),
    ],
  },
  {
    name: 'g2-h3n2-2025',
    requests: [
      agg(h3n2, fluFilters('2025-01-01', '2025-12-31')),
      agg(h3n2, { ...fluFilters('2025-01-01', '2025-12-31'), advancedQuery: flu.coverage }),
      agg(h3n2, { ...fluFilters('2025-01-01', '2025-12-31'), advancedQuery: flu.mismatch }),
    ],
  },
  {
    name: 'g3-conserved-control',
    requests: [
      agg(sc2, sc2Filters('2024-01-01', '2025-06-30')),
      agg(sc2, { ...sc2Filters('2024-01-01', '2025-06-30'), advancedQuery: control.coverage }),
      agg(sc2, { ...sc2Filters('2024-01-01', '2025-06-30'), advancedQuery: control.mismatch }),
    ],
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const testCase of CASES) {
    const records: FixtureRecord[] = [];
    for (const request of testCase.requests) {
      process.stdout.write(`${testCase.name} <- ${request.endpoint}\n`);
      const response = await transport.query(request);
      records.push({
        request: { baseUrl: request.baseUrl, endpoint: request.endpoint, body: request.body },
        response: { data: response.data, dataVersion: response.dataVersion, requestId: response.requestId },
      });
    }
    writeFileSync(join(OUT, `${testCase.name}.json`), `${JSON.stringify(records, null, 2)}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});

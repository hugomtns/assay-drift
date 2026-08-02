import { describe, it, expect } from 'vitest';
import { createFixtureTransport, type FixtureRecord } from './fixture-transport';

const records: FixtureRecord[] = [
  {
    request: { baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { a: 1, b: 2 } },
    response: { data: [{ count: 42 }], dataVersion: 'dv', requestId: 'rid' },
  },
];

describe('createFixtureTransport', () => {
  it('matches a request regardless of body key order', async () => {
    const t = createFixtureTransport(records);
    const res = await t.query({ baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { b: 2, a: 1 } });
    expect(res.data).toEqual([{ count: 42 }]);
    expect(res.dataVersion).toBe('dv');
  });

  it('throws a diagnostic error when no fixture matches', async () => {
    const t = createFixtureTransport(records);
    await expect(
      t.query({ baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { a: 9 } }),
    ).rejects.toThrow(/no fixture/i);
    await expect(
      t.query({ baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { a: 9 } }),
    ).rejects.toThrow(/"a":1/);
  });
});

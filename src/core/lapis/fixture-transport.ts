import { cacheKey } from './caching-transport';
import type { LapisRequest, LapisResponse, LapisTransport } from './transport';

export interface FixtureRecord {
  request: { baseUrl: string; endpoint: string; body: Record<string, unknown> };
  response: { data: unknown[]; dataVersion: string; requestId: string };
}

export function createFixtureTransport(records: FixtureRecord[]): LapisTransport {
  const index = new Map<string, FixtureRecord>();
  for (const record of records) {
    index.set(cacheKey(record.request as unknown as LapisRequest), record);
  }

  return {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      const key = cacheKey(req);
      const hit = index.get(key);
      if (!hit) {
        throw new Error(
          `No fixture recorded for:\n  ${key}\nAvailable:\n  ${[...index.keys()].join('\n  ')}`,
        );
      }
      return {
        data: hit.response.data as T[],
        dataVersion: hit.response.dataVersion,
        requestId: hit.response.requestId,
      };
    },
  };
}

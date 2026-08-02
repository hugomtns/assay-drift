import type { LapisRequest, LapisResponse, LapisTransport } from './transport';

const STORAGE_PREFIX = 'adw:q:';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function cacheKey(req: LapisRequest): string {
  return `${req.baseUrl}|${req.endpoint}|${stableStringify(req.body)}`;
}

interface Entry {
  at: number;
  value: LapisResponse<unknown>;
}

export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours; LAPIS data updates daily at most

export function withCache(
  inner: LapisTransport,
  opts: { ttlMs?: number; storage?: Storage | null; now?: () => number } = {},
): LapisTransport {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const storage =
    opts.storage === undefined
      ? (typeof sessionStorage === 'undefined' ? null : sessionStorage)
      : opts.storage;

  const memory = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<LapisResponse<unknown>>>();

  const readStorage = (key: string): Entry | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_PREFIX + key);
      return raw ? (JSON.parse(raw) as Entry) : null;
    } catch {
      return null;
    }
  };

  const writeStorage = (key: string, entry: Entry): void => {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // storage full or unavailable; the memory cache still works
    }
  };

  return {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      const key = cacheKey(req);
      const fresh = (e: Entry | null): boolean => e !== null && now() - e.at < ttlMs;

      const hit = memory.get(key) ?? readStorage(key);
      if (fresh(hit)) return hit!.value as LapisResponse<T>;

      const existing = inFlight.get(key);
      if (existing) return (await existing) as LapisResponse<T>;

      const promise = inner.query<T>(req).then((value) => {
        const entry: Entry = { at: now(), value: value as LapisResponse<unknown> };
        memory.set(key, entry);
        writeStorage(key, entry);
        return value as LapisResponse<unknown>;
      });
      inFlight.set(key, promise);
      try {
        return (await promise) as LapisResponse<T>;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

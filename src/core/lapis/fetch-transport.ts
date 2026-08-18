import { utf8ByteLength } from './size-guard';
import type { LapisRequest, LapisResponse, LapisTransport } from './transport';

export class LapisError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly requestId: string | null;

  constructor(status: number, detail: string, requestId: string | null) {
    super(`LAPIS ${status}: ${detail}`);
    this.name = 'LapisError';
    this.status = status;
    this.detail = detail;
    this.requestId = requestId;
  }
}

interface ErrorBody {
  error?: { status?: number; title?: string; detail?: string };
  info?: { requestId?: string };
}

interface SuccessBody<T> {
  data: T[];
  info?: { dataVersion?: string; requestId?: string };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms); });

export function createFetchTransport(
  opts: {
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): LapisTransport {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? defaultSleep;

  return {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      const url = `${req.baseUrl}/sample/${req.endpoint}`;
      let attempt = 0;

      for (;;) {
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(req.body),
          ...(req.signal ? { signal: req.signal } : {}),
        });

        if (res.ok) {
          // `res.text()` then `JSON.parse`, rather than `res.json()`, because
          // this is the only place in the chain where the size of a response
          // is still knowable. `res.json()` discards the text before returning
          // and `LapisResponse` never sees a byte count; `Content-Length` is
          // the gzipped figure and answers a different question.
          //
          // The cost is one string held alive across the parse. In Node and
          // undici that is what `res.json()` does internally anyway
          // (`JSON.parse(await this.text())`), so on the heaviest payload --
          // the 3.3 MB mutations response -- this is the same peak in
          // practice; a browser engine that parses straight from bytes would
          // pay one transient string more. It is paid for a real number
          // instead of an estimate extrapolated from a row count, which is the
          // only alternative that does not touch the text at all.
          const text = await res.text();
          const body = JSON.parse(text) as SuccessBody<T>;
          return {
            data: body.data,
            dataVersion: body.info?.dataVersion ?? 'unknown',
            requestId: body.info?.requestId ?? 'unknown',
            // Measured without allocating a copy of `text`. See `size-guard.ts`.
            responseBytes: utf8ByteLength(text),
          };
        }

        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= maxRetries) {
          let detail = `HTTP ${res.status}`;
          let requestId: string | null = null;
          try {
            const body = (await res.json()) as ErrorBody;
            if (body.error?.detail) detail = body.error.detail;
            requestId = body.info?.requestId ?? null;
          } catch {
            // non-JSON error body; keep the status-only detail
          }
          throw new LapisError(res.status, detail, requestId);
        }

        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : 500 * 2 ** attempt;
        await sleep(waitMs);
        attempt += 1;
      }
    },
  };
}

export type LapisEndpoint = 'aggregated' | 'nucleotideMutations' | 'nucleotideInsertions';

export interface LapisRequest {
  baseUrl: string;
  endpoint: LapisEndpoint;
  body: Record<string, unknown>;
  signal?: AbortSignal | undefined;
}

export interface LapisResponse<T> {
  data: T[];
  dataVersion: string;
  requestId: string;
  /**
   * Size of the decoded response body in bytes, when the transport was able to
   * measure it.
   *
   * Optional, and the optionality is the point: only a transport that actually
   * moved bytes can answer this. `createFixtureTransport` replays a recorded
   * object and never saw a wire, so it leaves this undefined rather than
   * reporting the size of a file on disk as if it were a download. Consumers
   * must treat `undefined` as *unmeasured*, not as *small* -- there is nothing
   * to warn about if nothing was measured.
   *
   * This is the decoded size, not `Content-Length`. LAPIS serves gzip and
   * `fetch` decompresses transparently, so `Content-Length` is the compressed
   * figure and answers a different question.
   */
  responseBytes?: number;
}

export interface LapisTransport {
  query<T>(req: LapisRequest): Promise<LapisResponse<T>>;
}

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
}

export interface LapisTransport {
  query<T>(req: LapisRequest): Promise<LapisResponse<T>>;
}

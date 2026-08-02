import type { AggregatedRow } from '../lapis/endpoints';
import { MAX_ATTRIBUTION_ROWS } from './constants';

export interface AttributionRow {
  value: string;
  count: number;
  /** Share of `total`, i.e. of all sequences carrying a mismatch in this window. */
  share: number;
}

export interface Attribution {
  field: string;
  rows: AttributionRow[];
  otherCount: number;
  /** Sequences whose value for this field is null or blank. */
  unassignedCount: number;
  total: number;
  topShare: number;
}

export function buildAttribution(
  rows: AggregatedRow[],
  field: string,
  opts: { limit?: number } = {},
): Attribution {
  const limit = opts.limit ?? MAX_ATTRIBUTION_ROWS;
  let unassignedCount = 0;
  const named: { value: string; count: number }[] = [];

  for (const row of rows) {
    const raw = row[field];
    if (typeof raw !== 'string' || raw === '') {
      unassignedCount += row.count;
      continue;
    }
    named.push({ value: raw, count: row.count });
  }

  named.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const total = named.reduce((s, r) => s + r.count, 0) + unassignedCount;
  const head = named.slice(0, limit);
  const otherCount = named.slice(limit).reduce((s, r) => s + r.count, 0);

  return {
    field,
    rows: head.map((r) => ({ ...r, share: total === 0 ? 0 : r.count / total })),
    otherCount,
    unassignedCount,
    total,
    topShare: total === 0 ? 0 : (head[0]?.count ?? 0) / total,
  };
}

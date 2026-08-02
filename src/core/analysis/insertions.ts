import type { WindowSpec } from '../query';
import type { InsertionRow } from '../lapis/endpoints';

export interface WindowInsertion {
  /** Reference position AFTER which the bases are inserted. */
  refPos: number;
  insertedSymbols: string;
  count: number;
  /**
   * Count divided by the window's full-coverage denominator. The insertions
   * endpoint reports no coverage of its own, so this is an approximation and
   * must be labelled as such wherever it is shown.
   */
  fractionOfDenominator: number;
}

export function insertionsInWindow(
  w: WindowSpec,
  rows: InsertionRow[],
  denominator: number,
): WindowInsertion[] {
  const positions = w.positions.map((p) => p.refPos);
  const low = Math.min(...positions);
  const high = Math.max(...positions);

  return rows
    .filter((row) => {
      const segmentMatches =
        w.qualifier !== null
          ? row.sequenceName === w.qualifier
          : row.sequenceName === null || row.sequenceName === w.segment;
      return segmentMatches && row.position >= low && row.position <= high;
    })
    .map((row) => ({
      refPos: row.position,
      insertedSymbols: row.insertedSymbols,
      count: row.count,
      fractionOfDenominator: denominator === 0 ? 0 : row.count / denominator,
    }))
    .sort((a, b) => b.count - a.count || a.refPos - b.refPos);
}

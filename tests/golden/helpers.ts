import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixtureTransport, type FixtureRecord } from '../../src/core/lapis/fixture-transport';
import type { LapisTransport } from '../../src/core/lapis/transport';

export function loadFixtureSet(name: string): LapisTransport {
  const path = join(process.cwd(), 'tests', 'fixtures', `${name}.json`);
  return createFixtureTransport(JSON.parse(readFileSync(path, 'utf8')) as FixtureRecord[]);
}

/** Builds the two window queries for a coordinate range without going through a binding search. */
export function windowQueries(
  from: number, to: number, qualifier: string | null,
): { coverage: string; mismatch: string } {
  const label = (p: number) => (qualifier ? `${qualifier}:${p}` : `${p}`);
  const positions = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const ambiguity = positions.map((p) => `${label(p)}N`).join(' | ');
  return {
    coverage: `!(${ambiguity})`,
    mismatch: `(${positions.map(label).join(' | ')}) & !(${ambiguity})`,
  };
}

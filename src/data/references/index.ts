import type { PathogenId } from '../../core/registry';
import type { ReferenceGenome } from '../../core/reference';
import sarsCov2 from './sars-cov-2.json';
import h5n1 from './h5n1.json';
import h3n2 from './h3n2.json';

interface ReferenceFile {
  pathogenId: string;
  fetchedAt: string;
  source: string;
  segments: { name: string; sequence: string }[];
}

const FILES: Record<PathogenId, ReferenceFile> = {
  'sars-cov-2': sarsCov2 as ReferenceFile,
  h5n1: h5n1 as ReferenceFile,
  h3n2: h3n2 as ReferenceFile,
};

export function loadReference(id: PathogenId): ReferenceGenome {
  const file = FILES[id];
  if (!file) throw new Error(`No bundled reference for "${id}"`);
  return { pathogenId: file.pathogenId, segments: file.segments };
}

export function referenceFetchedAt(id: PathogenId): string {
  return FILES[id].fetchedAt;
}

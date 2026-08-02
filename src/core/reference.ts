export interface ReferenceSegment {
  name: string;
  sequence: string;
}

export interface ReferenceGenome {
  pathogenId: string;
  segments: ReferenceSegment[];
}

export function getSegment(ref: ReferenceGenome, name: string): ReferenceSegment {
  const seg = ref.segments.find((s) => s.name === name);
  if (!seg) throw new Error(`Unknown segment "${name}" in reference ${ref.pathogenId}`);
  return seg;
}

/** 1-based, inclusive. */
export function baseAt(ref: ReferenceGenome, segment: string, pos1: number): string {
  const seg = getSegment(ref, segment);
  if (pos1 < 1 || pos1 > seg.sequence.length) {
    throw new Error(`Position ${pos1} out of range for ${segment} (length ${seg.sequence.length})`);
  }
  return seg.sequence[pos1 - 1] as string;
}

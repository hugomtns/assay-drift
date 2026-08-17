import { describe, it, expect } from 'vitest';
import { verifyAssay, type LibraryAssay } from './schema';
import { loadReference } from '../references';
import { reverseComplement } from '../../core/iupac';

/**
 * Every sequence in this file is sliced out of the bundled reference at test
 * time rather than typed in, so nothing here can drift from the reference and no
 * remembered primer can enter the suite (Global Constraint 2).
 *
 * Forward: plus strand 3001-3022. Reverse: reverse complement of 3179-3200.
 * Amplicon = 3200 - 3001 + 1 = 200 nt, inside the 50-300 nt window, so this is
 * the library's first assay that verifies cleanly.
 */
const ref = loadReference('sars-cov-2');
const main = ref.segments[0]!;
const slice = (start1: number, end1: number): string => main.sequence.slice(start1 - 1, end1);

const forwardSeq = slice(3001, 3022);
const reverseSeq = reverseComplement(slice(3179, 3200));

function assay(forward: string, reverse: string): LibraryAssay {
  return {
    id: 'derived-ok',
    name: 'Derived assay',
    pathogenId: 'sars-cov-2',
    target: 'ORF1ab',
    oligos: [
      { name: 'Derived-F', role: 'forward', sequence: forward },
      { name: 'Derived-R', role: 'reverse', sequence: reverse },
    ],
    citation: {
      title: 'Bundled reference',
      source: 'Derived in-test',
      url: 'https://example.org/derived',
      accessed: '2026-08-17',
    },
  };
}

/** Changes exactly one base, the way a transcription slip would. */
function typo(seq: string, index0: number): string {
  const base = seq[index0]!;
  return seq.slice(0, index0) + (base === 'A' ? 'C' : 'A') + seq.slice(index0 + 1);
}

describe('verifyAssay reports where every oligo landed', () => {
  it('verifies a clean assay and returns each oligo site with its mismatch count', () => {
    const result = verifyAssay(assay(forwardSeq, reverseSeq));

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.resolved).toEqual([
      {
        name: 'Derived-F',
        role: 'forward',
        segment: main.name,
        strand: 'plus',
        start: 3001,
        end: 3022,
        mismatches: 0,
      },
      {
        name: 'Derived-R',
        role: 'reverse',
        segment: main.name,
        strand: 'minus',
        start: 3179,
        end: 3200,
        mismatches: 0,
      },
    ]);
  });

  /**
   * The gate's stated tolerance is <=1 mismatch, so a single mistyped base still
   * passes. That is deliberate — published oligos legitimately differ from one
   * reference at a position — but it is also exactly the slip this gate exists to
   * catch, so the mismatch count must be reported rather than swallowed. This
   * test pins the tolerance AND the visibility that compensates for it; if the
   * count ever stops being reported, this fails.
   */
  it('still passes a single mistyped base, but reports the mismatch', () => {
    const result = verifyAssay(assay(typo(forwardSeq, 11), reverseSeq));

    expect(result.ok).toBe(true);
    expect(result.resolved[0]).toMatchObject({
      name: 'Derived-F',
      start: 3001,
      end: 3022,
      mismatches: 1,
    });
    expect(result.resolved[1]).toMatchObject({ name: 'Derived-R', mismatches: 0 });
  });

  it('reports nothing for an oligo that failed to resolve', () => {
    const result = verifyAssay({
      ...assay(forwardSeq, reverseSeq),
      oligos: [
        { name: 'Missing-F', role: 'forward', sequence: 'G'.repeat(forwardSeq.length) },
        { name: 'Derived-R', role: 'reverse', sequence: reverseSeq },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.resolved.map((r) => r.name)).toEqual(['Derived-R']);
  });
});

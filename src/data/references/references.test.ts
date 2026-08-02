import { describe, it, expect } from 'vitest';
import { loadReference } from './index';

describe('bundled reference genomes', () => {
  it('has SARS-CoV-2 as a single 29903 nt segment named main', () => {
    const ref = loadReference('sars-cov-2');
    expect(ref.segments).toHaveLength(1);
    expect(ref.segments[0]!.name).toBe('main');
    expect(ref.segments[0]!.sequence).toHaveLength(29903);
  });

  it('matches the reference bases at the Alpha deletion window', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(21764, 21786)).toBe('TACATGTCTCTGGGACCAATGG');
  });

  it('matches the reference bases at the conserved control window', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(15783, 15805)).toBe('TTTAAGTCAGTTCTTTATTATC');
  });

  it('has eight segments for each influenza instance', () => {
    for (const id of ['h5n1', 'h3n2'] as const) {
      const ref = loadReference(id);
      expect(ref.segments.map((s) => s.name)).toEqual(
        ['seg1', 'seg2', 'seg3', 'seg4', 'seg5', 'seg6', 'seg7', 'seg8'],
      );
    }
  });

  it('has the verified HA segment lengths', () => {
    expect(loadReference('h5n1').segments[3]!.sequence).toHaveLength(1760);
    expect(loadReference('h3n2').segments[3]!.sequence).toHaveLength(1737);
  });

  it('contains only unambiguous IUPAC characters', () => {
    for (const id of ['sars-cov-2', 'h5n1', 'h3n2'] as const) {
      for (const seg of loadReference(id).segments) {
        expect(seg.sequence).toMatch(/^[ACGTRYSWKMBDHVN]+$/);
      }
    }
  });
});

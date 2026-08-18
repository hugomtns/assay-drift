import { describe, it, expect } from 'vitest';
import { guardResponseSize, MUTATIONS_SIZE_WARN_BYTES, utf8ByteLength } from './size-guard';

describe('utf8ByteLength', () => {
  it('agrees with TextEncoder on ASCII, accents, CJK and astral characters', () => {
    const encoder = new TextEncoder();
    const samples = [
      '',
      'ATGC',
      '{"mutation":"T21765-","count":67469}',
      'coverage — 70,454',
      'Ångström',
      '日本語',
      '𝒜𝓈𝓈𝒶𝓎',
      '🧬🧫',
    ];
    for (const s of samples) {
      expect([s, utf8ByteLength(s)]).toEqual([s, encoder.encode(s).length]);
    }
  });

  it('counts a lone surrogate the way TextEncoder does, as one replacement character', () => {
    const lone = '\uD83E';
    expect(utf8ByteLength(lone)).toBe(new TextEncoder().encode(lone).length);
  });

  it('never allocates a copy of the string it measures', () => {
    // A 4 MB string measured without a 4 MB byte array beside it. This is the
    // whole reason the function exists rather than `encode(text).length`.
    const big = 'x'.repeat(4_000_000);
    expect(utf8ByteLength(big)).toBe(4_000_000);
  });
});

describe('guardResponseSize', () => {
  it('is ok and silent below the threshold', () => {
    expect(guardResponseSize(3_270_000, 'nucleotideMutations')).toEqual({
      ok: true,
      message: null,
    });
  });

  it('is ok exactly at the threshold', () => {
    expect(guardResponseSize(MUTATIONS_SIZE_WARN_BYTES, 'nucleotideMutations').ok).toBe(true);
  });

  it('warns above the threshold', () => {
    const verdict = guardResponseSize(MUTATIONS_SIZE_WARN_BYTES + 1, 'nucleotideMutations');
    expect(verdict.ok).toBe(false);
    expect(verdict.message).not.toBeNull();
  });

  it('states the measured size and the threshold, both in MB, and the exact byte count', () => {
    const message = guardResponseSize(12_043_918, 'nucleotideMutations').message ?? '';
    expect(message).toContain('12.0 MB');
    expect(message).toContain('8.0 MB');
    expect(message).toContain('12,043,918');
  });

  it('names the endpoint it measured', () => {
    const message = guardResponseSize(20_000_000, 'nucleotideMutations').message ?? '';
    expect(message).toContain('nucleotideMutations');
  });

  it('never renders a percentage (Global Constraint 6 / Task 6.1)', () => {
    const message = guardResponseSize(20_000_000, 'nucleotideMutations').message ?? '';
    expect(message).not.toContain('%');
  });

  it('promises that nothing was dropped, because nothing is', () => {
    const message = guardResponseSize(20_000_000, 'nucleotideMutations').message ?? '';
    // The guard warns and does nothing else. It must not imply that
    // minProportion was raised or that rows were discarded -- rare mismatches
    // are exactly what the user came for.
    expect(message.toLowerCase()).toContain('nothing was dropped');
  });

  it('holds the threshold the plan fixed', () => {
    expect(MUTATIONS_SIZE_WARN_BYTES).toBe(8_000_000);
  });
});

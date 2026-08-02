import { describe, it, expect } from 'vitest';
import { parseOligoText } from './oligo-input';

describe('parseOligoText', () => {
  it('parses FASTA with multi-line sequences', () => {
    const { oligos, errors } = parseOligoText('>N1-F\nGACCCCAAAA\nTCAGCGAAAT\n>N1-R\nTCTGGTTACTGCCAGTTGAATCTG');
    expect(errors).toEqual([]);
    expect(oligos).toHaveLength(2);
    expect(oligos[0]).toMatchObject({ name: 'N1-F', sequence: 'GACCCCAAAATCAGCGAAAT', role: 'forward' });
    expect(oligos[1]!.role).toBe('reverse');
  });

  it('parses bare sequence lines and leaves the role unset', () => {
    const { oligos } = parseOligoText('ACGTACGTACGTACGT\nTTTTGGGGCCCCAAAA');
    expect(oligos).toHaveLength(2);
    expect(oligos[0]!.role).toBeNull();
    expect(oligos[0]!.name).toBe('Oligo 1');
  });

  it('guesses probe roles from common naming', () => {
    const { oligos } = parseOligoText('>2019-nCoV_N1-Probe\nACCCCGCATTACGTTTGGTGGACC');
    expect(oligos[0]!.role).toBe('probe');
  });

  it('normalises whitespace, case and U', () => {
    const { oligos } = parseOligoText('>x\nacg u acg uacgtacgt');
    expect(oligos[0]!.sequence).toBe('ACGTACGTACGTACGT');
  });

  it('reports invalid characters without dropping the other oligos', () => {
    const { oligos, errors } = parseOligoText('>bad\nACGTXACGTACGT\n>good\nACGTACGTACGTACGT');
    expect(oligos.map((o) => o.name)).toEqual(['good']);
    expect(errors[0]).toMatch(/bad/);
    expect(errors[0]).toMatch(/X/);
  });

  it('rejects sequences that are too short or too long', () => {
    const { oligos, errors } = parseOligoText('>tiny\nACGTACG\n>huge\n' + 'A'.repeat(61));
    expect(oligos).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).toMatch(/12/);
    expect(errors.join(' ')).toMatch(/60/);
  });

  it('assigns stable unique ids', () => {
    const { oligos } = parseOligoText('>a\nACGTACGTACGTACGT\n>a\nTTTTGGGGCCCCAAAA');
    expect(new Set(oligos.map((o) => o.id)).size).toBe(2);
  });
});

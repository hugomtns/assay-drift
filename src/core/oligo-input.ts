import { normalizeOligo } from './iupac';

export type OligoRole = 'forward' | 'reverse' | 'probe';

export interface OligoInput {
  id: string;
  name: string;
  role: OligoRole | null;
  sequence: string;
}

export interface ParseResult {
  oligos: OligoInput[];
  errors: string[];
}

export const MIN_OLIGO_LENGTH = 12;
export const MAX_OLIGO_LENGTH = 60;

export function guessRole(name: string): OligoRole | null {
  const n = name.toLowerCase();
  if (/(probe|prb|[-_]p$|[-_]p[-_])/.test(n)) return 'probe';
  if (/(reverse|rev|[-_]r$|[-_]r[-_])/.test(n)) return 'reverse';
  if (/(forward|fwd|fw|[-_]f$|[-_]f[-_])/.test(n)) return 'forward';
  return null;
}

interface RawEntry {
  name: string;
  lines: string[];
  named: boolean;
}

export function parseOligoText(text: string): ParseResult {
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;
  let anonymousCount = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('>')) {
      current = { name: line.slice(1).trim() || `Oligo ${entries.length + 1}`, lines: [], named: true };
      entries.push(current);
    } else if (current && current.named) {
      current.lines.push(line);
    } else {
      anonymousCount += 1;
      current = { name: `Oligo ${anonymousCount}`, lines: [line], named: false };
      entries.push(current);
    }
  }

  const oligos: OligoInput[] = [];
  const errors: string[] = [];

  entries.forEach((entry, index) => {
    const joined = entry.lines.join('');
    let sequence: string;
    try {
      sequence = normalizeOligo(joined);
    } catch (err) {
      errors.push(`${entry.name}: ${(err as Error).message}`);
      return;
    }
    if (sequence.length < MIN_OLIGO_LENGTH) {
      errors.push(`${entry.name}: sequence is ${sequence.length} nt; the minimum is ${MIN_OLIGO_LENGTH} nt.`);
      return;
    }
    if (sequence.length > MAX_OLIGO_LENGTH) {
      errors.push(`${entry.name}: sequence is ${sequence.length} nt; the maximum is ${MAX_OLIGO_LENGTH} nt.`);
      return;
    }
    oligos.push({ id: `oligo-${index}`, name: entry.name, role: guessRole(entry.name), sequence });
  });

  return { oligos, errors };
}

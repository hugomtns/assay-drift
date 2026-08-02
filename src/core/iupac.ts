export const IUPAC_SETS: Readonly<Record<string, string>> = Object.freeze({
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
});

const COMPLEMENT: Readonly<Record<string, string>> = Object.freeze({
  A: 'T', C: 'G', G: 'C', T: 'A',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
});

export function normalizeOligo(raw: string): string {
  const cleaned = raw.replace(/[\s0-9]/g, '').toUpperCase().replace(/U/g, 'T');
  for (const ch of cleaned) {
    if (!(ch in IUPAC_SETS)) {
      throw new Error(`Not a valid IUPAC nucleotide code: "${ch}"`);
    }
  }
  return cleaned;
}

const ACCEPTED_CACHE = new Map<string, ReadonlySet<string>>();

export function acceptedBases(code: string): ReadonlySet<string> {
  const cached = ACCEPTED_CACHE.get(code);
  if (cached) return cached;
  const expansion = IUPAC_SETS[code];
  const set: ReadonlySet<string> = new Set(expansion ? [...expansion] : []);
  ACCEPTED_CACHE.set(code, set);
  return set;
}

export function basesMatch(a: string, b: string): boolean {
  const setA = acceptedBases(a);
  if (setA.size === 0) return false;
  for (const base of acceptedBases(b)) {
    if (setA.has(base)) return true;
  }
  return false;
}

export function reverseComplement(seq: string): string {
  let out = '';
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    const ch = seq[i] as string;
    const comp = COMPLEMENT[ch];
    if (comp === undefined) throw new Error(`Cannot complement "${ch}"`);
    out += comp;
  }
  return out;
}

export function degeneracyProduct(seq: string): number {
  let product = 1;
  for (const ch of seq) product *= acceptedBases(ch).size;
  return product;
}

export function complementBase(code: string): string {
  const comp = COMPLEMENT[code];
  if (comp === undefined) throw new Error(`Cannot complement "${code}"`);
  return comp;
}

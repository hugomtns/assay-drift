/**
 * Fetches reference genomes from each configured LAPIS instance and writes them
 * to src/data/references/<id>.json.
 *
 * The reference MUST come from the same instance that serves the mutation data,
 * otherwise reported coordinates and our binding-site coordinates can silently
 * disagree. Never substitute an NCBI RefSeq download.
 *
 * Run: npx tsx scripts/fetch-references.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATHOGENS } from '../src/core/registry.js';

interface ReferenceGenomeResponse {
  nucleotideSequences: { name: string; sequence: string }[];
}

const OUT_DIR = join(process.cwd(), 'src', 'data', 'references');

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const cfg of Object.values(PATHOGENS)) {
    const url = `${cfg.lapisBaseUrl}/sample/referenceGenome`;
    process.stdout.write(`Fetching ${cfg.id} from ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${cfg.id}: HTTP ${res.status}`);
    const body = (await res.json()) as ReferenceGenomeResponse;
    const segments = body.nucleotideSequences.map((s) => ({
      name: s.name,
      sequence: s.sequence.toUpperCase(),
    }));
    if (segments.length === 0) throw new Error(`${cfg.id}: no segments returned`);
    if (cfg.segmented !== segments.length > 1) {
      throw new Error(
        `${cfg.id}: registry says segmented=${String(cfg.segmented)} but got ${segments.length} segment(s)`,
      );
    }
    const payload = {
      pathogenId: cfg.id,
      fetchedAt: new Date().toISOString().slice(0, 10),
      source: url,
      segments,
    };
    writeFileSync(join(OUT_DIR, `${cfg.id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(
      `  ${segments.map((s) => `${s.name}:${s.sequence.length}`).join(' ')}\n`,
    );
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});

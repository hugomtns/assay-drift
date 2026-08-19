import { resolveBindingSite } from '../core/resolution';
import type { BindingSite } from '../core/binding';
import libraryRaw from '../data/assays/library.json';
import { parseLibrary, type LibraryAssay } from '../data/assays/schema';
import { loadReference } from '../data/references';
import { useAppStore } from '../state/store';

const WORKED_EXAMPLE_DATE_FROM = '2020-01-01';

function bundledAssay(id: string): LibraryAssay {
  const assay = parseLibrary(libraryRaw).assays.find((candidate) => candidate.id === id);
  if (assay === undefined) throw new Error(`The bundled assay library has no assay with id "${id}".`);
  return assay;
}

export const WORKED_EXAMPLE = bundledAssay('cdc-2019-ncov-n1');

/** Loads and resolves the bundled example. `false` leaves the user at binding. */
export function prepareWorkedExample(): boolean {
  const store = useAppStore.getState();
  store.setPathogen(WORKED_EXAMPLE.pathogenId);
  const oligos = WORKED_EXAMPLE.oligos.map((oligo, index) => ({
    id: `oligo-${index}`,
    name: oligo.name,
    role: oligo.role,
    sequence: oligo.sequence,
  }));
  useAppStore.getState().setOligos(oligos);

  const reference = loadReference(WORKED_EXAMPLE.pathogenId);
  const sites: Record<string, BindingSite> = {};
  for (const oligo of oligos) {
    const resolution = resolveBindingSite(oligo.sequence, reference);
    useAppStore.getState().setResolution(oligo.id, resolution);
    if (resolution.chosen === null) {
      useAppStore.getState().goTo('binding');
      return false;
    }
    sites[oligo.id] = resolution.chosen;
  }
  useAppStore.getState().commitSites(sites);
  useAppStore.getState().setScope({ dateFrom: WORKED_EXAMPLE_DATE_FROM });
  return true;
}

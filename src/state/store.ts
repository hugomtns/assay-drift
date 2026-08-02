import { create } from 'zustand';
import type { BindingSite } from '../core/binding';
import type { OligoInput, OligoRole } from '../core/oligo-input';
import type { Resolution } from '../core/resolution';
import { getPathogen, type PathogenId } from '../core/registry';
import type { Scope } from '../core/scope';
import type { AnalysisResult } from '../core/analysis/run';

export { REGULATORY_STATEMENT } from '../core/analysis/constants';

export type Step = 'input' | 'binding' | 'scope' | 'results';
export type Status = 'idle' | 'loading' | 'ready' | 'error';

function defaultScope(pathogenId: PathogenId, today = new Date()): Scope {
  const cfg = getPathogen(pathogenId);
  const to = new Date(today);
  const from = new Date(today);
  from.setMonth(from.getMonth() - cfg.defaultWindowMonths);
  return {
    pathogenId,
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    countries: [],
    lineages: [],
  };
}

interface AppState {
  step: Step;
  pathogenId: PathogenId;
  oligos: OligoInput[];
  roles: Record<string, OligoRole>;
  resolutions: Record<string, Resolution>;
  chosenSites: Record<string, BindingSite>;
  scope: Scope;
  result: AnalysisResult | null;
  status: Status;
  error: string | null;

  setPathogen(id: PathogenId): void;
  setOligos(oligos: OligoInput[]): void;
  setRole(oligoId: string, role: OligoRole): void;
  setResolution(oligoId: string, resolution: Resolution): void;
  chooseSite(oligoId: string, site: BindingSite): void;
  setScope(partial: Partial<Scope>): void;
  goTo(step: Step): void;
  startAnalysis(): void;
  analysisSucceeded(result: AnalysisResult): void;
  analysisFailed(message: string): void;
  reset(): void;
}

const initial = (pathogenId: PathogenId = 'sars-cov-2') => ({
  step: 'input' as Step,
  pathogenId,
  oligos: [] as OligoInput[],
  roles: {} as Record<string, OligoRole>,
  resolutions: {} as Record<string, Resolution>,
  chosenSites: {} as Record<string, BindingSite>,
  scope: defaultScope(pathogenId),
  result: null,
  status: 'idle' as Status,
  error: null,
});

export const useAppStore = create<AppState>((set) => ({
  ...initial(),

  setPathogen: (id) => set(() => ({ ...initial(id) })),
  setOligos: (oligos) =>
    set(() => ({
      oligos,
      roles: Object.fromEntries(
        oligos.filter((o) => o.role !== null).map((o) => [o.id, o.role as OligoRole]),
      ),
      resolutions: {},
      chosenSites: {},
      result: null,
      status: 'idle',
      error: null,
    })),
  setRole: (oligoId, role) => set((s) => ({ roles: { ...s.roles, [oligoId]: role } })),
  setResolution: (oligoId, resolution) =>
    set((s) => ({ resolutions: { ...s.resolutions, [oligoId]: resolution } })),
  chooseSite: (oligoId, site) => set((s) => ({ chosenSites: { ...s.chosenSites, [oligoId]: site } })),
  setScope: (partial) => set((s) => ({ scope: { ...s.scope, ...partial }, result: null })),
  goTo: (step) => set(() => ({ step })),
  startAnalysis: () => set(() => ({ status: 'loading', error: null })),
  analysisSucceeded: (result) => set(() => ({ status: 'ready', result, step: 'results' })),
  analysisFailed: (message) => set(() => ({ status: 'error', error: message })),
  reset: () => set(() => ({ ...initial() })),
}));

import { useCallback, useEffect, useRef } from 'react';
import { runAnalysis, type AnalysisOligo } from '../core/analysis/run';
import { loadReference } from '../data/references';
import type { LapisTransport } from '../core/lapis/transport';
import { useAppStore } from '../state/store';
import { publishPermalink } from './permalink';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : `Unexpected error: ${String(error)}`;

function analysisOligos(state: ReturnType<typeof useAppStore.getState>): AnalysisOligo[] {
  return state.oligos.flatMap((oligo) => {
    const role = state.roles[oligo.id] ?? oligo.role;
    const site = state.chosenSites[oligo.id];
    return role === null || site === undefined ? [] : [{ ...oligo, role, site }];
  });
}

/** Starts one analysis at a time and ensures stale runs cannot publish or write state. */
export function useAnalysisRunner(transport: LapisTransport): () => void {
  const running = useRef<AbortController | null>(null);
  const start = useCallback(() => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    const state = useAppStore.getState();
    const { scope } = state;
    const oligos = analysisOligos(state);
    const reference = loadReference(scope.pathogenId);

    state.startAnalysis();
    runAnalysis({ transport, scope, oligos, reference, signal: controller.signal })
      .then((analysis) => {
        if (controller.signal.aborted) return;
        useAppStore.getState().analysisSucceeded(analysis);
        publishPermalink(scope, oligos);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) useAppStore.getState().analysisFailed(messageOf(error));
      });
  }, [transport]);

  useEffect(() => () => { running.current?.abort(); }, []);
  return start;
}

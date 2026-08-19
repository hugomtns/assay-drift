import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../state/store';
import { prepareWorkedExample } from './worked-example';

describe('prepareWorkedExample', () => {
  beforeEach(() => { useAppStore.getState().reset(); });

  it('loads all bundled oligos, committed sites, and the advertised date range', () => {
    expect(prepareWorkedExample()).toBe(true);
    const state = useAppStore.getState();
    expect(state.oligos).toHaveLength(3);
    expect(Object.keys(state.chosenSites)).toHaveLength(3);
    expect(state.scope.dateFrom).toBe('2020-01-01');
  });
});

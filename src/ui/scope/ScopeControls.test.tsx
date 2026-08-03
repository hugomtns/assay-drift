import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScopeControls } from './ScopeControls';
import { useAppStore } from '../../state/store';
// Imports below this line support the added suites at the foot of the file;
// the suite above is transcribed from the task brief unchanged.
import { act, waitFor, within } from '@testing-library/react';
import type { LapisRequest, LapisResponse, LapisTransport } from '../../core/lapis/transport';

beforeEach(() => { useAppStore.getState().reset(); });

describe('ScopeControls', () => {
  it('prefills the pathogen default window', () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const from = screen.getByLabelText(/collected from/i) as HTMLInputElement;
    const to = screen.getByLabelText(/collected to/i) as HTMLInputElement;
    expect(from.value).toBe(useAppStore.getState().scope.dateFrom);
    expect(to.value <= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it('writes date changes into the store', async () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const from = screen.getByLabelText(/collected from/i);
    await userEvent.clear(from);
    await userEvent.type(from, '2021-02-01');
    expect(useAppStore.getState().scope.dateFrom).toBe('2021-02-01');
  });

  it('rejects an inverted date range', async () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const to = screen.getByLabelText(/collected to/i);
    await userEvent.clear(to);
    await userEvent.type(to, '1999-01-01');
    expect(await screen.findByText(/end date must be on or after/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run analysis/i })).toBeDisabled();
  });

  it('states that an empty filter means all', () => {
    render(<ScopeControls onRun={vi.fn()} />);
    expect(screen.getAllByText(/all countries|all lineages|all clades/i).length).toBeGreaterThan(0);
  });

  it('labels the lineage control with the pathogen-specific term', () => {
    useAppStore.getState().setPathogen('h3n2');
    render(<ScopeControls onRun={vi.fn()} />);
    expect(screen.getByLabelText(/HA clade/i)).toBeInTheDocument();
  });

  it('calls onRun when the button is pressed', async () => {
    const onRun = vi.fn();
    render(<ScopeControls onRun={onRun} />);
    await userEvent.click(screen.getByRole('button', { name: /run analysis/i }));
    expect(onRun).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Added beyond the brief. Every test above renders without a transport, so the
// option-list load -- the only part of this component that touches the network,
// and the only part bound by Global Constraint 9 (all network calls are
// abortable) -- is entirely uncovered by them. These exercise it against fake
// transports, so the suite stays offline and deterministic.
// ---------------------------------------------------------------------------

const fieldOf = (req: LapisRequest): string => {
  const fields = req.body['fields'];
  return Array.isArray(fields) && typeof fields[0] === 'string' ? fields[0] : '';
};

/** Answers each `fields=[x]` query with the values listed for `x`. */
const optionTransport = (valuesByField: Record<string, string[]>) => {
  const signals: (AbortSignal | undefined)[] = [];
  const transport: LapisTransport = {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      signals.push(req.signal);
      const field = fieldOf(req);
      const data = (valuesByField[field] ?? []).map((value) => ({ count: 1, [field]: value }));
      return { data: data as unknown as T[], dataVersion: 'v', requestId: 'r' };
    },
  };
  return { transport, signals };
};

/** Never settles until its signal aborts, then rejects the way `fetch` does. */
const pendingTransport = () => {
  const signals: AbortSignal[] = [];
  const transport: LapisTransport = {
    query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      if (req.signal) signals.push(req.signal);
      return new Promise<LapisResponse<T>>((_resolve, reject) => {
        req.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    },
  };
  return { transport, signals };
};

const failingTransport = (): LapisTransport => ({
  async query<T>(): Promise<LapisResponse<T>> {
    throw new Error('LAPIS unavailable');
  },
});

describe('ScopeControls option lists', () => {
  it('issues no query at all when no transport is supplied', () => {
    // The guarantee that keeps `npm test` offline: the six tests above pass a
    // bare `onRun` and must never reach the network. A default transport
    // inside the component would break this and nothing else would notice.
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<ScopeControls onRun={vi.fn()} />);
    expect(spy).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText(/country/i)).queryAllByRole('option')).toEqual([]);
    spy.mockRestore();
  });

  it('fills both selects from one query per field, sorted and de-duplicated', async () => {
    const { transport, signals } = optionTransport({
      country: ['Germany', 'Denmark', 'Germany'],
      pangoLineage: ['BA.2', 'BA.1'],
    });
    render(<ScopeControls onRun={vi.fn()} transport={transport} />);

    await screen.findByRole('option', { name: 'Denmark' });
    const countries = within(screen.getByLabelText(/country/i)).getAllByRole('option');
    expect(countries.map((o) => o.textContent)).toEqual(['Denmark', 'Germany']);
    const lineages = within(screen.getByLabelText(/pango lineage/i)).getAllByRole('option');
    expect(lineages.map((o) => o.textContent)).toEqual(['BA.1', 'BA.2']);
    expect(signals).toHaveLength(2);
  });

  it('writes a country selection into the store', async () => {
    const { transport } = optionTransport({ country: ['Denmark', 'Germany'] });
    render(<ScopeControls onRun={vi.fn()} transport={transport} />);

    await screen.findByRole('option', { name: 'Germany' });
    await userEvent.selectOptions(screen.getByLabelText(/country/i), ['Germany']);
    expect(useAppStore.getState().scope.countries).toEqual(['Germany']);
  });

  it('stays usable while the lists are still loading', () => {
    const { transport } = pendingTransport();
    render(<ScopeControls onRun={vi.fn()} transport={transport} />);
    expect(screen.getByLabelText(/country/i)).toBeEnabled();
    expect(screen.getByRole('button', { name: /run analysis/i })).toBeEnabled();
  });

  it('aborts the in-flight option load on unmount (Global Constraint 9)', () => {
    const { transport, signals } = pendingTransport();
    const { unmount } = render(<ScopeControls onRun={vi.fn()} transport={transport} />);

    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.aborted)).toEqual([false, false]);
    unmount();
    expect(signals.map((s) => s.aborted)).toEqual([true, true]);
  });

  it('aborts the previous load on a pathogen change without reporting it as a failure', async () => {
    // Regression: the abort raised by the effect cleanup rejects the load, and
    // an unguarded `.catch` would paint the *new* pathogen's step with the old
    // pathogen's failure notice. The `live` flag is what stops it.
    const { transport, signals } = pendingTransport();
    render(<ScopeControls onRun={vi.fn()} transport={transport} />);
    expect(signals).toHaveLength(2);

    await act(async () => {
      useAppStore.getState().setPathogen('h5n1');
    });

    expect(signals.map((s) => s.aborted)).toEqual([true, true, false, false]);
    await waitFor(() => {
      expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/clade/i)).toBeInTheDocument();
  });

  it('survives a failed option load with the step still runnable', async () => {
    render(<ScopeControls onRun={vi.fn()} transport={failingTransport()} />);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run analysis/i })).toBeEnabled();
    expect(screen.getByLabelText(/country/i)).toBeEnabled();
    // An empty filter still means "all", so nothing about the step is broken.
    expect(useAppStore.getState().scope.countries).toEqual([]);
  });
});

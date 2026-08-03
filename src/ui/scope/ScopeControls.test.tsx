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

  it('aborts the previous load on a pathogen change and relabels for the new one', async () => {
    // What this actually covers is the abort itself, plus the relabelling.
    // It does NOT cover the `live` guard, despite an earlier comment here
    // claiming it did: with `live` removed, the aborted run's `.catch` stamps
    // the result with the *old* `cfg.id` captured in its closure, so the
    // render-time pathogen stamp discards it and no notice appears anyway.
    // The test below is the one that holds `live` up.
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

  it('does not report a failure when a transport swap aborts the previous load', async () => {
    // The one path the pathogen stamp cannot cover, and therefore the only
    // real guard on the `live` flag: `transport` changes while `pathogenId`
    // stays put. The aborted run's `.catch` then stamps the *current*
    // pathogen, the stamp check passes, and without `live` a spurious "could
    // not be loaded" is painted over a reload that is still in flight.
    // Task 4.7 swapping a transport is exactly how this arises.
    const first = pendingTransport();
    const second = pendingTransport();
    const { rerender } = render(<ScopeControls onRun={vi.fn()} transport={first.transport} />);
    expect(first.signals).toHaveLength(2);

    rerender(<ScopeControls onRun={vi.fn()} transport={second.transport} />);
    // A macrotask boundary, so every microtask the aborts queued has run --
    // asserting an absence is only worth anything once the thing has had its
    // chance to appear.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(first.signals.map((s) => s.aborted)).toEqual([true, true]);
    expect(second.signals.map((s) => s.aborted)).toEqual([false, false]);
    expect(useAppStore.getState().pathogenId).toBe('sars-cov-2');
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
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

// Fix round 1, finding 1. A selection lives in the store, but the options that
// make it *visible* live in this component's `useState`. Any path that empties
// the option list while a selection survives -- a remount (step back, step
// forward: fresh `useState`, `loaded === null`), or a failed load -- used to
// render an empty listbox under the words "Leave empty to include all
// countries" while `scopeToFilters` was still narrowing the analysis to
// Germany. The UI claimed the analysis was unfiltered at the exact moment it
// was filtered, and nothing failed loudly.
describe('ScopeControls with a selection the option list does not contain', () => {
  it('keeps the selection visible and selected when no options have loaded', () => {
    useAppStore.getState().setScope({ countries: ['Germany'], lineages: ['BA.2'] });
    render(<ScopeControls onRun={vi.fn()} />);

    const countries = within(screen.getByLabelText(/country/i)).getAllByRole('option');
    expect(countries.map((o) => o.textContent)).toEqual(['Germany']);
    expect((countries[0] as HTMLOptionElement).selected).toBe(true);

    const lineages = within(screen.getByLabelText(/pango lineage/i)).getAllByRole('option');
    expect(lineages.map((o) => o.textContent)).toEqual(['BA.2']);
    expect((lineages[0] as HTMLOptionElement).selected).toBe(true);

    // Still filtering, and now saying so.
    expect(useAppStore.getState().scope.countries).toEqual(['Germany']);
  });

  it('merges a selection into a loaded list without duplicating or unsorting it', async () => {
    useAppStore.getState().setScope({ countries: ['Denmark', 'Norway'] });
    const { transport } = optionTransport({ country: ['Germany', 'Denmark'] });
    render(<ScopeControls onRun={vi.fn()} transport={transport} />);

    await screen.findByRole('option', { name: 'Germany' });
    const countries = within(screen.getByLabelText(/country/i)).getAllByRole('option');
    expect(countries.map((o) => o.textContent)).toEqual(['Denmark', 'Germany', 'Norway']);
    const selected = countries.filter((o) => (o as HTMLOptionElement).selected);
    expect(selected.map((o) => o.textContent)).toEqual(['Denmark', 'Norway']);
  });

  it('names the filters it is still applying when the option lists fail to load', async () => {
    useAppStore.getState().setScope({ countries: ['Germany'], lineages: ['BA.2'] });
    render(<ScopeControls onRun={vi.fn()} transport={failingTransport()} />);

    const notice = await screen.findByText(/could not be loaded/i);
    expect(notice).toHaveTextContent('Germany');
    expect(notice).toHaveTextContent('BA.2');
    // The "empty means everything" reassurance is false here and must not show.
    expect(notice).not.toHaveTextContent(/analyses everything/i);
  });
});

// Fix round 1, finding 3. The messages existed but were floating siblings: a
// screen-reader user who tabbed back to the offending date field was told
// nothing was wrong with it, and the disabled button gave no reason at all.
// Deliberately narrow -- Task 6.2 owns accessibility properly; this is only the
// association between a message and the control it is about.
describe('ScopeControls validation messaging', () => {
  it('associates the inverted-range message with both date fields and the button', async () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const to = screen.getByLabelText(/collected to/i);
    await userEvent.clear(to);
    await userEvent.type(to, '1999-01-01');

    expect(to).toHaveAccessibleDescription(/end date must be on or after/i);
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/collected from/i)).toHaveAttribute('aria-invalid', 'true');
    // The button is `disabled`, so it is out of the tab order and cannot be
    // reached to discover why. The description is what carries the reason.
    expect(screen.getByRole('button', { name: /run analysis/i })).toHaveAccessibleDescription(
      /end date must be on or after/i,
    );
  });

  it('announces a missing date politely rather than assertively', async () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const from = screen.getByLabelText(/collected from/i);
    await userEvent.clear(from);

    const message = await screen.findByText(/enter both a start and an end/i);
    // `role="alert"` here would interrupt mid-keystroke every time someone
    // clears a date to retype it, which is the normal way to edit one.
    expect(message).toHaveAttribute('role', 'status');
    expect(from).toHaveAccessibleDescription(/enter both a start and an end/i);
    expect(from).toHaveAttribute('aria-invalid', 'true');
  });

  it('mounts every message region before it has anything to say', () => {
    // A live region inserted at the same instant as its text is frequently
    // never announced; it has to be in the document first.
    render(<ScopeControls onRun={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('');
    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    expect(statuses.every((region) => region.textContent === '')).toBe(true);
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ExactCoverageToggle } from './ExactCoverageToggle';
import type { PositionStat } from '../../core/analysis/profile';
import { sampleAnalysis, sampleScope } from '../../core/analysis/test-fixtures';
import { MAX_EXACT_COVERAGE_POSITIONS } from '../../core/lapis/endpoints';
import type { LapisRequest, LapisTransport } from '../../core/lapis/transport';
import { getPathogen } from '../../core/registry';
import { scopeToFilters } from '../../core/scope';

const cfg = getPathogen('sars-cov-2');
const filters = scopeToFilters(sampleScope, cfg);

/**
 * A transport whose every response can be released by hand, so a fan-out can
 * be observed while it is still in flight.
 */
const deferred = () => {
  const seen: LapisRequest[] = [];
  const release: (() => void)[] = [];
  const transport: LapisTransport = {
    query(req) {
      seen.push(req);
      return new Promise((resolve) => {
        release.push(() => {
          resolve({ data: [{ count: 12345 }], dataVersion: 'v', requestId: 'r' } as never);
        });
      });
    },
  };
  return { seen, release, transport };
};

const immediate = (count = 12345): { seen: LapisRequest[]; transport: LapisTransport } => {
  const seen: LapisRequest[] = [];
  return {
    seen,
    transport: {
      async query(req) {
        seen.push(req);
        return { data: [{ count }], dataVersion: 'v', requestId: 'r' } as never;
      },
    },
  };
};

const renderToggle = (
  transport: LapisTransport,
  onCoverage: (profile: PositionStat[]) => void = () => undefined,
  analysis = sampleAnalysis,
) =>
  render(
    <ExactCoverageToggle
      analysis={analysis}
      transport={transport}
      cfg={cfg}
      filters={filters}
      onCoverage={onCoverage}
    />,
  );

describe('ExactCoverageToggle', () => {
  it('states the exact number of extra queries before anything is committed', () => {
    const { seen, transport } = immediate();
    renderToggle(transport);
    expect(sampleAnalysis.window.positions).toHaveLength(22);
    expect(screen.getByRole('button', { name: /22 extra queries/ })).toBeInTheDocument();
    // Nothing has been issued: it is opt-in, never automatic.
    expect(seen).toHaveLength(0);
  });

  it('issues one query per position and hands back a profile with measured denominators', async () => {
    const user = userEvent.setup();
    const { seen, transport } = immediate(12345);
    const onCoverage = vi.fn();
    renderToggle(transport, onCoverage);

    await user.click(screen.getByRole('button', { name: /extra queries/ }));

    await waitFor(() => {
      expect(onCoverage).toHaveBeenCalledOnce();
    });
    expect(seen).toHaveLength(22);
    const profile = onCoverage.mock.calls[0]![0] as PositionStat[];
    expect(profile.every((p) => !p.coverageIsInferred)).toBe(true);
    expect(profile.every((p) => p.effectiveDenominator === 12345)).toBe(true);
    // A new array: the analysis's own profile is never mutated, so a later
    // failure cannot leave a half-exact chart behind.
    expect(profile).not.toBe(sampleAnalysis.profile);
  });

  it('says so afterwards instead of offering the same load again', async () => {
    const user = userEvent.setup();
    const { transport } = immediate();
    renderToggle(transport);
    await user.click(screen.getByRole('button', { name: /extra queries/ }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /extra queries/ })).toBeNull();
    });
    expect(screen.getByRole('status').textContent).toMatch(/22 quer/);
  });

  it('is unavailable with a reason above the position cap, and does nothing if clicked', async () => {
    const user = userEvent.setup();
    const { seen, transport } = immediate();
    const long = {
      ...sampleAnalysis,
      window: {
        ...sampleAnalysis.window,
        positions: Array.from({ length: MAX_EXACT_COVERAGE_POSITIONS + 1 }, (_, i) => ({
          ...sampleAnalysis.window.positions[0]!,
          refPos: 1000 + i,
          oligoIndex: i,
        })),
      },
    };
    renderToggle(transport, () => undefined, long);

    const button = screen.getByRole('button', { name: /extra queries/ });
    // Task 6.2's idiom: still focusable, aria-disabled, and it says why.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const reason = document.getElementById(describedBy!);
    expect(reason?.textContent).toMatch(/61/);
    expect(reason?.textContent).toMatch(new RegExp(String(MAX_EXACT_COVERAGE_POSITIONS)));

    const before = reason?.textContent;
    await user.click(button);
    expect(seen).toHaveLength(0);
    // Inert, not merely styled that way: the click changed no state at all, so
    // the region still carries the reason and not a failure from a fan-out
    // that should never have been started.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(screen.getByRole('status').textContent).toBe(before);
    expect(screen.getByRole('status').textContent).not.toMatch(/bars below are unchanged/);
  });

  it('aborts the fan-out when it unmounts, and the late result is never written', async () => {
    const user = userEvent.setup();
    const { seen, release, transport } = deferred();
    const onCoverage = vi.fn();
    const { unmount } = renderToggle(transport, onCoverage);

    await user.click(screen.getByRole('button', { name: /extra queries/ }));
    await waitFor(() => {
      expect(seen).toHaveLength(22);
    });
    expect(seen.every((r) => r.signal?.aborted === false)).toBe(true);

    unmount();
    expect(seen.every((r) => r.signal?.aborted === true)).toBe(true);

    // The requests land anyway, as a real in-flight fetch would. A macrotask
    // tick drains every microtask behind them, so if the settle path were
    // going to write, it would have written by here.
    for (const r of release) r();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(onCoverage).not.toHaveBeenCalled();
  });

  it('does not apply anything when part of the fan-out fails, and names the positions', async () => {
    const user = userEvent.setup();
    const onCoverage = vi.fn();
    const failed = [21767, 21770];
    const transport: LapisTransport = {
      async query(req) {
        const q = req.body['advancedQuery'] as string;
        if (failed.some((p) => q === `!(${String(p)}N)`)) throw new Error('HTTP 500');
        return { data: [{ count: 12345 }], dataVersion: 'v', requestId: 'r' } as never;
      },
    };
    renderToggle(transport, onCoverage);

    await user.click(screen.getByRole('button', { name: /extra queries/ }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/21767/);
    });
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toMatch(/21770/);
    expect(status).toMatch(/2 of 22/);
    expect(onCoverage).not.toHaveBeenCalled();
    // And the offer stands, because nothing was changed.
    expect(screen.getByRole('button', { name: /extra queries/ })).toBeInTheDocument();
  });

  it('renders no literal percent sign (Global Constraint 6)', async () => {
    const user = userEvent.setup();
    const { transport } = immediate();
    const { container } = renderToggle(transport);
    await user.click(screen.getByRole('button', { name: /extra queries/ }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/22 quer/);
    });
    expect(container.textContent).not.toContain('%');
  });
});

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrendChart } from './TrendChart';
import type { TrendPoint, TrendSeries } from '../../core/analysis/trend';

const point = (bucket: string, nFullCoverage: number, nMismatch: number): TrendPoint => ({
  bucket,
  nFullCoverage,
  nMismatch,
  mismatchFraction: nMismatch / nFullCoverage,
  sufficientData: true,
});

/** A bucket below MIN_DENOMINATOR: counted, but with no computable rate. */
const thin = (bucket: string, nFullCoverage: number, nMismatch: number): TrendPoint => ({
  bucket,
  nFullCoverage,
  nMismatch,
  mismatchFraction: null,
  sufficientData: false,
});

const trend = (points: TrendPoint[], over: Partial<TrendSeries> = {}): TrendSeries => ({
  granularity: 'month',
  points,
  undatedFullCoverage: 0,
  undatedMismatch: 0,
  ...over,
});

const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('TrendChart', () => {
  it('renders a figure with a caption', () => {
    const { container } = render(
      <TrendChart trend={trend([point('2024-01', 1000, 100)])} />,
    );
    expect(screen.getByRole('figure')).toBeInTheDocument();
    const caption = container.querySelector('figcaption');
    expect(caption).not.toBeNull();
    expect(caption?.textContent ?? '').toMatch(/month/i);
  });

  it('exposes an equivalent table to assistive technology', () => {
    render(
      <TrendChart
        trend={trend([point('2024-01', 1000, 100), point('2024-02', 2000, 40)])}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('2024-01');
    expect(rows[0]).toHaveTextContent('100');
    expect(rows[0]).toHaveTextContent('1,000');
    expect(rows[1]).toHaveTextContent('2024-02');
    expect(rows[1]).toHaveTextContent('40');
    expect(rows[1]).toHaveTextContent('2,000');
  });

  it('renders a gap, not a zero, for a thin bucket', () => {
    const { container } = render(
      <TrendChart
        trend={trend([
          point('2024-01', 1000, 100),
          point('2024-02', 1000, 120),
          thin('2024-03', 20, 3),
          point('2024-04', 1000, 90),
          point('2024-05', 1000, 80),
        ])}
      />,
    );

    const thinRow = bodyRows()[2];
    expect(thinRow).toHaveTextContent('2024-03');
    expect(thinRow).toHaveTextContent(/not enough data/i);
    expect(thinRow?.textContent ?? '').not.toContain('0%');

    // The line breaks into two subpaths rather than dipping to the axis, and
    // the thin bucket gets no plotted vertex at all.
    const paths = container.querySelectorAll('svg path');
    expect(paths).toHaveLength(1);
    const d = paths[0]?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
    expect(container.querySelectorAll('svg circle')).toHaveLength(4);
  });

  it('orders buckets chronologically', () => {
    render(
      <TrendChart
        trend={trend([
          point('2024-01', 1000, 100),
          point('2024-02', 1000, 120),
          point('2024-03', 1000, 90),
        ])}
      />,
    );
    const labels = bodyRows().map((row) => row.querySelector('th,td')?.textContent ?? '');
    expect(labels).toEqual(['2024-01', '2024-02', '2024-03']);
  });

  it('accounts for sequences that carry no usable collection date', () => {
    render(
      <TrendChart
        trend={trend([point('2024-01', 1000, 100)], {
          undatedFullCoverage: 42,
          undatedMismatch: 7,
        })}
      />,
    );
    expect(screen.getByText(/42/)).toHaveTextContent(/no usable collection date/i);
  });
});

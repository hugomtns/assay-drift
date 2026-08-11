import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AttributionTable } from './AttributionTable';
import type { Attribution } from '../../core/analysis/attribution';

const attribution = (over: Partial<Attribution> = {}): Attribution => ({
  field: 'pangoLineage',
  rows: [
    { value: 'BA.2.86', count: 1200, share: 0.6 },
    { value: 'JN.1', count: 600, share: 0.3 },
  ],
  otherCount: 0,
  unassignedCount: 0,
  total: 2000,
  topShare: 0.6,
  ...over,
});

describe('AttributionTable', () => {
  it('lists the top values with counts and shares', () => {
    render(<AttributionTable attribution={attribution()} label="Lineage" />);
    expect(screen.getByText('BA.2.86')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText('JN.1')).toBeInTheDocument();
    expect(screen.getByText('600')).toBeInTheDocument();
    expect(screen.getByText('30.0%')).toBeInTheDocument();
  });

  it('renders an other row only when the tail is non-empty', () => {
    const { unmount } = render(
      <AttributionTable attribution={attribution({ otherCount: 200 })} label="Lineage" />,
    );
    expect(screen.getByText(/^other$/i)).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    unmount();

    render(<AttributionTable attribution={attribution({ otherCount: 0 })} label="Lineage" />);
    expect(screen.queryByText(/^other$/i)).toBeNull();
  });

  it('renders an unassigned row only when non-zero', () => {
    const { unmount } = render(
      <AttributionTable attribution={attribution({ unassignedCount: 150 })} label="Lineage" />,
    );
    expect(screen.getByText(/^unassigned$/i)).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    unmount();

    render(<AttributionTable attribution={attribution({ unassignedCount: 0 })} label="Lineage" />);
    expect(screen.queryByText(/^unassigned$/i)).toBeNull();
  });

  it('states what the shares are of', () => {
    const { container } = render(
      <AttributionTable attribution={attribution()} label="Lineage" />,
    );
    const caption = container.querySelector('caption');
    expect(caption).not.toBeNull();
    expect(caption?.textContent ?? '').toContain('of sequences carrying a mismatch');
  });

  it('names the total the shares are taken over', () => {
    render(<AttributionTable attribution={attribution()} label="Lineage" />);
    expect(screen.getByText(/2,000/)).toBeInTheDocument();
  });
});

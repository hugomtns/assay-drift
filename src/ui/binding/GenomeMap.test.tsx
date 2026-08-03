import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { GenomeMap } from './GenomeMap';

describe('GenomeMap', () => {
  const sites = [
    { label: 'N1-F', start: 100, end: 120, strand: 'plus' as const },
    { label: 'N1-R', start: 200, end: 222, strand: 'minus' as const },
  ];

  it('labels the segment and its length', () => {
    render(<GenomeMap segmentLabel="Genome" segmentLength={29903} sites={sites} />);
    expect(screen.getByText(/Genome/)).toBeInTheDocument();
    expect(screen.getByText(/29,903/)).toBeInTheDocument();
  });

  it('exposes each site to assistive technology with its coordinates', () => {
    render(<GenomeMap segmentLabel="Genome" segmentLength={29903} sites={sites} />);
    expect(screen.getByLabelText(/N1-F.*100.*120/)).toBeInTheDocument();
    expect(screen.getByLabelText(/N1-R.*200.*222/)).toBeInTheDocument();
  });

  it('renders without sites', () => {
    render(<GenomeMap segmentLabel="Genome" segmentLength={29903} sites={[]} />);
    expect(screen.getByText(/Genome/)).toBeInTheDocument();
  });
});

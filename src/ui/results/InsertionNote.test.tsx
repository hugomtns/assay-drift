import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InsertionNote } from './InsertionNote';
import type { WindowInsertion } from '../../core/analysis/insertions';

const insertion = (over: Partial<WindowInsertion> = {}): WindowInsertion => ({
  refPos: 21765,
  insertedSymbols: 'GAT',
  count: 120,
  fractionOfDenominator: 120 / 70387,
  ...over,
});

describe('InsertionNote', () => {
  it('renders nothing when there are no insertions', () => {
    const { container } = render(<InsertionNote insertions={[]} denominator={70387} />);
    expect(container.firstChild).toBeNull();
  });

  it('names the position, the inserted bases and the count', () => {
    render(<InsertionNote insertions={[insertion()]} denominator={70387} />);
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('21,765');
    expect(item).toHaveTextContent('GAT');
    expect(item).toHaveTextContent('120');
  });

  it('states that the insertion endpoint reports no coverage', () => {
    render(<InsertionNote insertions={[insertion()]} denominator={70387} />);
    const explanation = screen.getByText(/no coverage/);
    expect(explanation).toHaveTextContent(/approximate/i);
  });

  it('shows the denominator alongside the fraction', () => {
    render(<InsertionNote insertions={[insertion()]} denominator={70387} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('70,387');
  });
});

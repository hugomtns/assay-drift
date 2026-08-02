import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RegulatoryNotice } from './RegulatoryNotice';
import { REGULATORY_STATEMENT } from '../state/store';

describe('RegulatoryNotice', () => {
  it('renders the exact statement', () => {
    render(<RegulatoryNotice />);
    expect(screen.getByText(REGULATORY_STATEMENT)).toBeInTheDocument();
  });
  it('is exposed to assistive technology as a note', () => {
    render(<RegulatoryNotice />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
  it('is not inside a details/summary disclosure', () => {
    const { container } = render(<RegulatoryNotice />);
    expect(container.querySelector('details')).toBeNull();
  });
});

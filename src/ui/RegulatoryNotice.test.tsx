import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RegulatoryNotice } from './RegulatoryNotice';

describe('RegulatoryNotice', () => {
  it('renders a compact persistent link to the complete statement', () => {
    render(<RegulatoryNotice />);
    const notice = screen.getByRole('link', { name: /research use only/i });
    expect(notice).toHaveAttribute('href', '#regulatory-statement');
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

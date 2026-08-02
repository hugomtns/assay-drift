import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the product name and the regulatory notice', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /assay drift watch/i })).toBeInTheDocument();
    expect(
      screen.getByText(/research and educational tool, not a diagnostic device/i),
    ).toBeInTheDocument();
  });
});

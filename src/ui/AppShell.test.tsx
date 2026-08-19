import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { REGULATORY_STATEMENT } from '../state/store';
import { AppShell } from './AppShell';

/**
 * The methods link is the one thing in the shell that leaves the app, so it is
 * the one thing that can silently stop working: `docs/methods.md` is not served
 * by the static build, and a link into `./docs/` would 404 in production while
 * passing every test written against the DOM. These assertions pin the shape
 * that cannot 404 -- an absolute URL at the repository -- and the accessible
 * name that says where it goes.
 */
describe('AppShell methods link', () => {
  it('names its destination and the fact that it leaves the app', () => {
    render(
      <AppShell step="input">
        <p>content</p>
      </AppShell>,
    );
    const link = screen.getByRole('link', {
      name: /methods and limitations \(opens on GitHub in a new tab\)/i,
    });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/hugomtns/assay-drift/blob/main/docs/methods.md',
    );
    // Absolute, not relative: the Vite build does not serve `docs/`.
    expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('AppShell identity and regulatory treatment', () => {
  it('keeps the compact research-use notice linked to the complete footer statement', () => {
    render(
      <AppShell step="input">
        <p>content</p>
      </AppShell>,
    );

    const notice = screen.getByRole('link', { name: /research use only/i });
    expect(notice).toHaveAttribute('href', '#regulatory-statement');
    expect(screen.getAllByText(REGULATORY_STATEMENT)).toHaveLength(1);
    expect(screen.getByText(/check recent genomic drift at assay binding sites/i)).toBeInTheDocument();
  });
});

describe('AppShell step navigation', () => {
  it('lets keyboard users return to every completed step and keeps future steps unavailable', async () => {
    const onStepChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <AppShell step="results" onStepChange={onStepChange}>
        <p>content</p>
      </AppShell>,
    );

    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: /return to oligos/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: /return to binding site/i }));
    await user.click(screen.getByRole('button', { name: /return to scope/i }));

    expect(onStepChange).toHaveBeenNthCalledWith(1, 'input');
    expect(onStepChange).toHaveBeenNthCalledWith(2, 'binding');
    expect(onStepChange).toHaveBeenNthCalledWith(3, 'scope');
    expect(screen.getByText(/current: results/i)).toHaveAttribute('aria-current', 'step');

    rerender(
      <AppShell step="input" onStepChange={onStepChange}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByText(/binding site unavailable/i)).toHaveAttribute('aria-disabled', 'true');
  });
});

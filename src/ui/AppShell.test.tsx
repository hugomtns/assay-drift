import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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

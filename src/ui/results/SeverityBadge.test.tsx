import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SeverityBadge } from './SeverityBadge';
import { SEVERITY_DISCLAIMER } from '../../core/analysis/constants';
import type { Severity } from '../../core/analysis/severity';

const severity = (over: Partial<Severity>): Severity =>
  ({ level: 'green', score: 0, reasons: [], ...over });

describe('SeverityBadge', () => {
  it.each([
    ['green', /fine/i],
    ['amber', /watch/i],
    ['red', /act on/i],
    ['unknown', /not enough data/i],
  ] as const)('labels %s in words, not only in colour', (level, label) => {
    render(<SeverityBadge severity={severity({ level })} role="forward" />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('always states that this is a heuristic', () => {
    render(<SeverityBadge severity={severity({ level: 'red' })} role="forward" />);
    expect(screen.getByText(SEVERITY_DISCLAIMER)).toBeInTheDocument();
  });

  it('lists every reason the heuristic gave', () => {
    render(
      <SeverityBadge
        severity={severity({ level: 'red', reasons: ['Reason one.', 'Reason two.'] })}
        role="forward"
      />,
    );
    expect(screen.getByText('Reason one.')).toBeInTheDocument();
    expect(screen.getByText('Reason two.')).toBeInTheDocument();
  });

  it('never claims to predict assay performance', () => {
    render(<SeverityBadge severity={severity({ level: 'red' })} role="forward" />);
    expect(document.body.textContent ?? '').not.toMatch(/will fail|predicts|guarantee/i);
  });
});

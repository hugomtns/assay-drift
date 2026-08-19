// Transcribed verbatim from implementation.md lines 6781-6808 (Task 6.1).
// Global Constraint 8 is discharged here, in one place.
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';
import { REGULATORY_STATEMENT } from './core/analysis/constants';
import { toPositionCsv, toSummaryCsv } from './core/export/csv';
import { toJsonExport } from './core/export/csv';
import { methodsParagraph } from './core/export/methods';
import { sampleResult } from './core/analysis/test-fixtures';

describe('the regulatory statement appears in all five required places', () => {
  it('header and footer', () => {
    render(<App />);
    expect(screen.getAllByText(REGULATORY_STATEMENT)).toHaveLength(1);
  });
  it('summary CSV', () => {
    expect(toSummaryCsv(sampleResult)).toContain(REGULATORY_STATEMENT);
  });
  it('position CSV', () => {
    expect(toPositionCsv(sampleResult)).toContain(REGULATORY_STATEMENT);
  });
  it('JSON export', () => {
    expect(JSON.parse(toJsonExport(sampleResult)).regulatoryStatement).toBe(REGULATORY_STATEMENT);
  });
  it('methods paragraph', () => {
    expect(methodsParagraph(sampleResult)).toContain(REGULATORY_STATEMENT);
  });
});

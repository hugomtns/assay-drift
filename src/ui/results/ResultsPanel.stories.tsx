import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AnalysisResult } from '../../core/analysis/run';
import { sampleResult } from '../../core/analysis/test-fixtures';
import { ResultsPanel } from './ResultsPanel';

const routineResult = {
  ...sampleResult,
  diagnostics: [],
  oligos: sampleResult.oligos.map((oligo) => ({
    ...oligo,
    severity: { ...oligo.severity, level: 'green' as const },
    diagnostics: [],
  })),
} satisfies AnalysisResult;

const longInsertionsResult = {
  ...routineResult,
  oligos: routineResult.oligos.map((oligo) => ({
    ...oligo,
    insertions: [
      { refPos: 21765, insertedSymbols: 'A', count: 24, fractionOfDenominator: 24 / 70387 },
      { refPos: 21766, insertedSymbols: 'T', count: 18, fractionOfDenominator: 18 / 70387 },
      { refPos: 21767, insertedSymbols: 'G', count: 12, fractionOfDenominator: 12 / 70387 },
      { refPos: 21768, insertedSymbols: 'C', count: 6, fractionOfDenominator: 6 / 70387 },
    ],
  })),
} satisfies AnalysisResult;

const meta = {
  title: 'Results/Panel',
  component: ResultsPanel,
  args: { result: sampleResult },
} satisfies Meta<typeof ResultsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RoutineCollapsed: Story = {
  args: { result: routineResult },
};

export const LongInsertions: Story = {
  args: { result: longInsertionsResult },
};

export const NarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

export const Warning: Story = {
  args: {
    result: {
      ...sampleResult,
      diagnostics: [
        { id: 'coverage-gap', severity: 'warn', message: 'The rate is not interpretable for one binding site.' },
      ],
    },
  },
};

export const InsufficientData: Story = {
  args: {
    result: {
      ...routineResult,
      oligos: routineResult.oligos.map((oligo) => ({
        ...oligo,
        metrics: { ...oligo.metrics, sufficientData: false },
        severity: { ...oligo.severity, level: 'unknown' as const, reasons: ['Too few assessable sequences.'] },
      })),
    },
  },
};

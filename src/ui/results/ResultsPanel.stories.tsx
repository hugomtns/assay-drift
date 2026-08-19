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

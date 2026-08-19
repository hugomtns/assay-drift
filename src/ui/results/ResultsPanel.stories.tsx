import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleResult } from '../../core/analysis/test-fixtures';
import { ResultsPanel } from './ResultsPanel';

const meta = {
  title: 'Results/Panel',
  component: ResultsPanel,
  args: { result: sampleResult },
} satisfies Meta<typeof ResultsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

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

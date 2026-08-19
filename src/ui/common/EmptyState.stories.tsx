import type { Meta, StoryObj } from '@storybook/react-vite';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'Common/Empty state',
  component: EmptyState,
  args: {
    pathogenLabel: 'SARS-CoV-2',
    lineageLabel: 'Pango lineage',
    scope: {
      pathogenId: 'sars-cov-2',
      dateFrom: '2025-01-01',
      dateTo: '2025-02-01',
      countries: [],
      lineages: [],
    },
    onChangeScope: () => undefined,
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FilteredScope: Story = {
  args: {
    scope: {
      pathogenId: 'sars-cov-2',
      dateFrom: '2025-01-01',
      dateTo: '2025-02-01',
      countries: ['New Zealand', 'United Kingdom of Great Britain and Northern Ireland'],
      lineages: ['XBB.1.5', 'JN.1'],
    },
  },
};

export const NarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

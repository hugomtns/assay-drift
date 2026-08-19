import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleResult } from '../../core/analysis/test-fixtures';
import { ExportButtons } from './ExportButtons';

const meta = {
  title: 'Results/Share and export',
  component: ExportButtons,
  args: { result: sampleResult },
} satisfies Meta<typeof ExportButtons>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleResult } from '../../core/analysis/test-fixtures';
import { PositionProfile } from './PositionProfile';

const meta = { title: 'Results/Position profile', component: PositionProfile, args: { analysis: sampleResult.oligos[0]! } } satisfies Meta<typeof PositionProfile>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const NarrowViewport: Story = {
  parameters: {
    viewport: { defaultViewport: 'narrow' },
    docs: { description: { story: 'The accessible data table stays visually hidden at narrow widths.' } },
  },
};

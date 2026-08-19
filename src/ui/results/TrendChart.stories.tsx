import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleResult } from '../../core/analysis/test-fixtures';
import { TrendChart } from './TrendChart';

const meta = { title: 'Results/Trend chart', component: TrendChart, args: { trend: sampleResult.oligos[0]!.trend } } satisfies Meta<typeof TrendChart>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const NarrowViewport: Story = { parameters: { viewport: { defaultViewport: 'narrow' } } };

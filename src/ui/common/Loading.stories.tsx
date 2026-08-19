import type { Meta, StoryObj } from '@storybook/react-vite';
import { Loading } from './Loading';

const meta = {
  title: 'Common/Loading',
  component: Loading,
  args: { what: 'SARS-CoV-2 sequences' },
} satisfies Meta<typeof Loading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithProgressDetail: Story = {
  args: { detail: 'Collecting mutation counts for 3 oligos.' },
};

export const NarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

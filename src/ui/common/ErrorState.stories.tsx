import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorState } from './ErrorState';

const meta = {
  title: 'Common/Error state',
  component: ErrorState,
  args: {
    message: 'LAPIS 503: the sequence aggregate is temporarily unavailable.',
    onRetry: () => undefined,
  },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongMessage: Story = {
  args: {
    message:
      'LAPIS 400: invalid advanced query. The requested lineage field is unavailable for the selected reference and no partial analysis was computed.',
  },
};

export const NarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useAppStore } from '../../state/store';
import { OligoInputPanel } from './OligoInputPanel';

const meta = {
  title: 'Input/Oligo input panel',
  component: OligoInputPanel,
  decorators: [
    (Story) => {
      useAppStore.getState().reset();
      return <Story />;
    },
  ],
} satisfies Meta<typeof OligoInputPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const ParsedOligo: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText(/paste your oligos/i), '>N1-F\nGACCCCAAAATCAGCGAAAT');
  },
};

export const MissingRole: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText(/paste your oligos/i), 'ACGTACGTACGTACGTACGT');
  },
};

export const ParseError: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText(/paste your oligos/i), '>bad\nACGTXACGTACGTACGT');
  },
};

export const NarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

export const LongContent: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText(/paste your oligos/i), '>A deliberately long oligo name that must wrap safely on narrow screens\nGACCCCAAAATCAGCGAAAT');
  },
};

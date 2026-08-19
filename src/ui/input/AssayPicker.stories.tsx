import type { Meta, StoryObj } from '@storybook/react-vite';
import { useAppStore } from '../../state/store';
import { AssayPicker } from './AssayPicker';

const meta = {
  title: 'Input/Assay picker',
  component: AssayPicker,
  decorators: [
    (Story) => {
      useAppStore.getState().reset();
      return <Story />;
    },
  ],
} satisfies Meta<typeof AssayPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRecommendedExample: Story = {
  args: { onRunExample: () => undefined },
};

export const NarrowViewport: Story = {
  args: { onRunExample: () => undefined },
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

export const InfluenzaLibrary: Story = {
  decorators: [
    (Story) => {
      useAppStore.getState().setPathogen('h3n2');
      return <Story />;
    },
  ],
};

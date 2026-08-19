import type { Meta, StoryObj } from '@storybook/react-vite';
import { useAppStore } from '../../state/store';
import { ScopeControls } from './ScopeControls';

const meta = {
  title: 'Scope/Controls',
  component: ScopeControls,
  decorators: [
    (Story) => {
      useAppStore.getState().reset();
      return <Story />;
    },
  ],
  args: { onRun: () => undefined },
} satisfies Meta<typeof ScopeControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SelectedFilters: Story = {
  decorators: [
    (Story) => {
      useAppStore.getState().setScope({ countries: ['Germany'], lineages: ['JN.1'] });
      return <Story />;
    },
  ],
};

export const NarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

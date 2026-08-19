import type { Meta, StoryObj } from '@storybook/react-vite';
import { useAppStore } from '../../state/store';
import { BindingResolution } from './BindingResolution';

const meta = {
  title: 'Binding/Resolution', component: BindingResolution,
  decorators: [(Story) => { useAppStore.getState().reset(); return <Story />; }],
} satisfies Meta<typeof BindingResolution>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Resolved: Story = {
  decorators: [(Story) => { useAppStore.getState().reset(); useAppStore.getState().setOligos([{ id: 'fixture', name: 'N1-F', role: 'forward', sequence: 'TACATGTCTCTGGGACCAATGG' }]); return <Story />; }],
};
export const Ambiguous: Story = {
  decorators: [(Story) => { useAppStore.getState().reset(); useAppStore.getState().setOligos([{ id: 'fixture', name: 'Ambiguous oligo', role: 'forward', sequence: 'TTTTTTTTTTTTTTTTTTTT' }]); return <Story />; }],
};

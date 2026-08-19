import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from './AppShell';

const meta = {
  title: 'Application/App shell',
  component: AppShell,
  args: {
    step: 'input',
    children: <p className="max-w-[70ch] text-sm">Enter one or more assay oligos to begin.</p>,
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CompactIdentity: Story = {
  args: { step: 'scope' },
};

export const WithPathogenSelector: Story = {
  args: {
    pathogenSelector: (
      <label className="flex max-w-sm flex-col gap-1 text-sm" htmlFor="storybook-pathogen">
        Pathogen
        <select id="storybook-pathogen" className="rounded border border-slate-300 px-2 py-1">
          <option>SARS-CoV-2</option>
        </select>
      </label>
    ),
  },
};

export const LongContent: Story = {
  args: {
    step: 'results',
    children: (
      <section className="flex max-w-[70ch] flex-col gap-3">
        <h2 className="text-xl font-semibold">Analysis result</h2>
        <p className="text-sm">
          This sample content checks that the shell keeps explanatory prose readable while data
          panels may use the available content width.
        </p>
      </section>
    ),
  },
};

export const NarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: 'narrow' } },
};

export const KeyboardFocus: Story = {
  args: {
    children: <button className="rounded bg-slate-900 px-4 py-2 text-white">Continue</button>,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    canvas.getByRole('button', { name: 'Continue' }).focus();
  },
};

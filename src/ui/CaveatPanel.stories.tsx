import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleResult } from '../core/analysis/test-fixtures';
import { CaveatPanel } from './CaveatPanel';

const meta = { title: 'Results/Limitations', component: CaveatPanel, args: { result: sampleResult } } satisfies Meta<typeof CaveatPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { result: { ...sampleResult, diagnostics: [], oligos: sampleResult.oligos.map((oligo) => ({ ...oligo, diagnostics: [] })) } } };
export const Warning: Story = { args: { result: { ...sampleResult, diagnostics: [{ id: 'coverage-gap', severity: 'warn', message: 'Fixture warning for review.' }] } } };

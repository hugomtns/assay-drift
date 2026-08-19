import type { Meta, StoryObj } from '@storybook/react-vite';
import { getPathogen } from '../../core/registry';
import { sampleResult } from '../../core/analysis/test-fixtures';
import type { LapisTransport } from '../../core/lapis/transport';
import { ExactCoverageToggle } from './ExactCoverageToggle';

const transport: LapisTransport = { query: async () => ({ data: [{ count: 70387 }], dataVersion: 'fixture', requestId: 'fixture' } as never) };
const meta = {
  title: 'Results/Exact coverage', component: ExactCoverageToggle,
  args: { analysis: sampleResult.oligos[0]!, transport, cfg: getPathogen(sampleResult.pathogenId), filters: {}, onCoverage: () => undefined },
} satisfies Meta<typeof ExactCoverageToggle>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};

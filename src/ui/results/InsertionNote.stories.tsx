import type { Meta, StoryObj } from '@storybook/react-vite';
import { sampleResult } from '../../core/analysis/test-fixtures';
import { InsertionNote } from './InsertionNote';

const insertion = { refPos: 21765, insertedSymbols: 'A', count: 12, fractionOfDenominator: 12 / 70387 };
const meta = { title: 'Results/Insertions', component: InsertionNote, args: { insertions: [insertion], denominator: 70387, oligoName: sampleResult.oligos[0]!.name } } satisfies Meta<typeof InsertionNote>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const LongList: Story = { args: { insertions: [insertion, { ...insertion, refPos: 21766, count: 9 }, { ...insertion, refPos: 21767, count: 6 }, { ...insertion, refPos: 21768, count: 3 }] } };

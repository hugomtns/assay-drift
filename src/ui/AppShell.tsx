import type { ReactNode } from 'react';
import { REGULATORY_STATEMENT, type Step } from '../state/store';
import { RegulatoryNotice } from './RegulatoryNotice';

const STEPS: Readonly<Array<{ id: Step; label: string }>> = [
  { id: 'input', label: 'Oligos' },
  { id: 'binding', label: 'Binding site' },
  { id: 'scope', label: 'Scope' },
  { id: 'results', label: 'Results' },
];

interface AppShellProps {
  step: Step;
  pathogenSelector?: ReactNode;
  children: ReactNode;
}

/**
 * Page-level layout: title, one-line explanation, the pathogen selector slot,
 * a numbered step indicator, the page content, and a footer that repeats the
 * regulatory statement. The header notice is never collapsed or hidden.
 */
export function AppShell({ step, pathogenSelector, children }: AppShellProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Assay Drift Watch</h1>
        <p className="text-sm text-slate-700">
          Check how much recent genomic drift affects a PCR or probe assay's binding sites.
        </p>
        <RegulatoryNotice />
        {pathogenSelector !== undefined && <div>{pathogenSelector}</div>}
        <ol className="flex flex-wrap gap-4 text-sm" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={i === currentIndex ? 'step' : undefined}
              className={i === currentIndex ? 'font-semibold text-slate-900' : 'text-slate-500'}
            >
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </header>

      <main>{children}</main>

      <footer className="border-t border-slate-200 pt-4 text-sm text-slate-600">
        {REGULATORY_STATEMENT}
      </footer>
    </div>
  );
}

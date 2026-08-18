import type { ReactNode } from 'react';
import { REGULATORY_STATEMENT, type Step } from '../state/store';
import { RegulatoryNotice } from './RegulatoryNotice';

/**
 * The methods statement, on GitHub rather than in the app.
 *
 * `docs/methods.md` is a repository file and the Vite build does not serve
 * `docs/`, so a relative link would 404 in production. The two ways out were to
 * copy the file into `public/` so it ships, or to point at the repository. The
 * copy loses: two files saying the same thing drift, and the one that drifts is
 * always the copy nobody edits -- which on a tool whose entire argument is
 * traceability would be worse than the 404. The repository link also carries
 * something the copy cannot, a revision history for the definitions themselves.
 *
 * It leaves the app, so the link text says so rather than relying on an icon.
 */
const METHODS_URL = 'https://github.com/hugomtns/assay-drift/blob/main/docs/methods.md';

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

      <footer className="flex flex-col gap-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
        <p>{REGULATORY_STATEMENT}</p>
        <p>
          <a
            className="text-slate-700 underline underline-offset-2 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            href={METHODS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            How these numbers are computed: methods and limitations (opens on GitHub in a new tab)
          </a>
        </p>
      </footer>
    </div>
  );
}

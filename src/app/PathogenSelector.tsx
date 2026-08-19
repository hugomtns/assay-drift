import { useState } from 'react';
import { PATHOGENS, type PathogenId } from '../core/registry';

interface PathogenSelectorProps {
  value: PathogenId;
  hasAnalysisInputs: boolean;
  onChange: (id: PathogenId) => void;
}

export function PathogenSelector({ value, hasAnalysisInputs, onChange }: PathogenSelectorProps) {
  const [requestedId, setRequestedId] = useState<PathogenId | null>(null);
  const requestedLabel = requestedId === null ? null : PATHOGENS[requestedId].label;
  const requestChange = (id: PathogenId): void => {
    if (id === value) return;
    if (hasAnalysisInputs) setRequestedId(id);
    else onChange(id);
  };

  return <div className="flex max-w-sm flex-col gap-2">
    <label htmlFor="pathogen-select" className="text-sm font-medium text-slate-900">Pathogen</label>
    <select id="pathogen-select" value={value} onChange={(event) => requestChange(event.target.value as PathogenId)} className="w-64 rounded border border-slate-300 px-2 py-1">
      {Object.values(PATHOGENS).map((cfg) => <option key={cfg.id} value={cfg.id}>{cfg.label}</option>)}
    </select>
    {requestedId !== null && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
      <p>{`Switch to ${requestedLabel}? Changing it clears the oligos and any analysis already run.`}</p>
      <button type="button" onClick={() => { onChange(requestedId); setRequestedId(null); }} className="rounded bg-slate-900 px-3 py-1 text-sm text-white">Change pathogen</button>
      <button type="button" onClick={() => { setRequestedId(null); }} className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-900">Keep current</button>
    </div>}
  </div>;
}

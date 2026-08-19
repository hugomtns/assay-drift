/**
 * A persistent, compact pointer to the complete research-use statement in the
 * page footer. The full statement remains visible there for auditability.
 */
export function RegulatoryNotice() {
  return (
    <aside role="note" className="text-sm text-slate-600">
      <a className="underline underline-offset-2" href="#regulatory-statement">
        Research use only
      </a>
    </aside>
  );
}

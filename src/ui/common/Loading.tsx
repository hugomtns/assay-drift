interface LoadingProps {
  /**
   * What is being queried, in the user's words -- "SARS-CoV-2 sequences", not
   * "data". A spinner that says only "Loading" tells someone waiting on a
   * multi-second network round trip nothing about whether it is worth waiting.
   */
  what: string;
  /** Optional second line: roughly how much work is in flight. */
  detail?: string | undefined;
}

/**
 * The in-flight state for anything that reaches LAPIS.
 *
 * `role="status"` rather than `role="alert"`: waiting is expected and polite,
 * and an assertive region would interrupt whatever a screen-reader user was
 * reading every time a query started.
 *
 * It is driven by the store's `status`, not by a promise this component
 * tracks, so there is exactly one source of truth for "an analysis is running"
 * and no way for the spinner and the data to disagree.
 */
export function Loading({ what, detail }: LoadingProps) {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-4"
    >
      <p className="text-sm font-medium text-slate-900">{`Querying ${what}…`}</p>
      {detail !== undefined && <p className="text-sm text-slate-600">{detail}</p>}
    </div>
  );
}

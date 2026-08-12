interface ErrorStateProps {
  /**
   * The raw message, exactly as it arrived. A `LapisError` stringifies to
   * `LAPIS 400: <detail>`, which names the field the API objected to.
   */
  message: string;
  onRetry: () => void;
}

/**
 * A failed query, shown in full.
 *
 * The raw detail is rendered verbatim and never replaced by a friendlier
 * summary. "Something went wrong" is unactionable: the difference between a
 * malformed advanced query, a rate limit and an unknown metadata field is the
 * entire content of the message, and swallowing it leaves the user with
 * nothing to report and nothing to change. It is rendered in a monospace block
 * so it can be copied into a bug report unaltered.
 *
 * `role="alert"` here, unlike `Loading`'s `role="status"`: a run the user asked
 * for has stopped, and they need to know now rather than on the next time they
 * happen to look.
 *
 * "Try again" retries rather than resetting. Most LAPIS failures are transient
 * (a 5xx, a rate limit, a dropped connection), and the scope and oligos that
 * produced the request are still in the store, so re-issuing it is one click
 * and loses nothing.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <section className="flex flex-col items-start gap-3">
      <div role="alert" className="flex flex-col gap-2 rounded bg-red-50 p-4 text-red-900">
        <p className="font-medium">The analysis could not be completed.</p>
        <p className="font-mono text-sm break-words">{message}</p>
        <p className="text-sm">
          Nothing has been computed from partial data. Retrying re-issues the same queries; if it
          keeps failing, narrowing the date range asks the API for less at once.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded bg-slate-900 px-4 py-2 text-white"
      >
        Try again
      </button>
    </section>
  );
}

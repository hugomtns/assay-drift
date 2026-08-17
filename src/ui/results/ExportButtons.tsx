import { useState } from 'react';
import type { AnalysisResult } from '../../core/analysis/run';
import { toJsonExport, toPositionCsv, toSummaryCsv } from '../../core/export/csv';
import { methodsParagraph } from '../../core/export/methods';

/**
 * A UTF-8 byte-order mark, on the CSVs only.
 *
 * Excel on Windows opens a BOM-less CSV in the system ANSI codepage, which
 * turns every non-ASCII character in the file into mojibake -- the em dashes in
 * the comment header, and any country or lineage value that is not plain ASCII.
 * The mark belongs here rather than in `toSummaryCsv`, because it is a fact
 * about handing a file to a spreadsheet, not about the CSV text itself: the
 * core functions stay comparable as strings, and the tests assert on what they
 * actually return.
 */
const UTF8_BOM = '\uFEFF';

/**
 * Hands the browser a file without ever touching the network or the disk from
 * the pure layer: `src/core/export` returns strings, and everything here is the
 * part that only a browser can do.
 *
 * The object URL is revoked, but on the next task rather than immediately.
 * Revoking synchronously after `click()` races the download some browsers have
 * not started yet, and the failure mode -- a button that silently does nothing
 * on one browser -- is worse than one turn of the event loop.
 */
function downloadFile(filename: string, mimeType: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_MESSAGES: Readonly<Record<CopyState, string>> = Object.freeze({
  idle: '',
  copied: 'Methods paragraph copied.',
  failed:
    'Could not reach the clipboard. Download the JSON instead — it carries the same methods paragraph.',
});

interface ExportButtonsProps {
  result: AnalysisResult;
}

/**
 * Downloads, and the methods paragraph.
 *
 * Two CSV buttons, not one behind a chooser. The plan names a single "Download
 * CSV" while requiring two shapes of CSV, and the two are not variants of one
 * file: one row per oligo answers "how bad is it", one row per position answers
 * "where". A dropdown would hide half the export behind an interaction and add
 * a piece of state whose only job is to be forgotten; two buttons are two tab
 * stops that each say what they give you.
 *
 * Every filename is stamped with `result.generatedAt`, never with today. A
 * result restored from a permalink last week must not produce a file that
 * claims to be from today -- the date in the name is the date of the data, and
 * it has to agree with the date in the file's own comment header.
 */
export function ExportButtons({ result }: ExportButtonsProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const stamp = result.generatedAt.slice(0, 10);
  const base = `assay-drift-${result.pathogenId}-${stamp}`;
  const csvType = 'text/csv;charset=utf-8';

  const copy = (): void => {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      setCopyState('failed');
      return;
    }
    clipboard.writeText(methodsParagraph(result)).then(
      () => {
        setCopyState('copied');
      },
      () => {
        setCopyState('failed');
      },
    );
  };

  const buttonClass = 'rounded border border-slate-900 px-3 py-1 text-sm text-slate-900';

  return (
    <section aria-labelledby="export-heading" className="flex flex-col gap-2">
      <h3 id="export-heading" className="text-base font-semibold">
        Take this away with you
      </h3>
      <p className="text-sm text-slate-700">
        Every file opens with a comment block carrying the unit of analysis, the data version and
        the scope, so a number lifted out of it can still be traced back.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            downloadFile(`${base}-summary.csv`, csvType, UTF8_BOM + toSummaryCsv(result));
          }}
        >
          Download CSV — one row per oligo
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            downloadFile(`${base}-positions.csv`, csvType, UTF8_BOM + toPositionCsv(result));
          }}
        >
          Download CSV — one row per position
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            downloadFile(`${base}.json`, 'application/json;charset=utf-8', toJsonExport(result));
          }}
        >
          Download JSON
        </button>
        <button type="button" className={buttonClass} onClick={copy}>
          Copy methods paragraph
        </button>
        {/*
          Always mounted with its text swapped in, exactly as CopyLinkButton in
          App.tsx does it: a live region inserted at the same instant as its
          text is frequently never announced.
        */}
        <span role="status" className="text-sm text-slate-600">
          {COPY_MESSAGES[copyState]}
        </span>
      </div>
    </section>
  );
}

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportButtons } from './ExportButtons';
import { UNIT_OF_ANALYSIS } from '../../core/analysis/constants';
import { sampleResult } from '../../core/analysis/test-fixtures';
import type { AnalysisResult } from '../../core/analysis/run';
import { methodsParagraph } from '../../core/export/methods';

/**
 * The shared G1 fixture, with only the timestamp overridden: these tests are
 * about the filename the buttons stamp, and that has to be the result's date
 * rather than today's. Everything else -- the oligo cut out of the bundled
 * reference, the real counts, the 22-position profile -- comes from
 * `src/core/analysis/test-fixtures`.
 */
const result: AnalysisResult = {
  ...sampleResult,
  generatedAt: '2021-03-02T09:15:00.000Z',
};

const SUMMARY_BUTTON = 'Download CSV — one row per oligo';
const POSITION_BUTTON = 'Download CSV — one row per position';

let handed: { url: string; blob: Blob }[] = [];
let revoked: string[] = [];
let clicked: { href: string; download: string }[] = [];

function install(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

beforeEach(() => {
  handed = [];
  revoked = [];
  clicked = [];
  install(URL, 'createObjectURL', (blob: Blob) => {
    const url = `blob:test-${handed.length + 1}`;
    handed.push({ url, blob });
    return url;
  });
  install(URL, 'revokeObjectURL', (url: string) => {
    revoked.push(url);
  });
  // Nothing is ever written to disk: the anchor's click is intercepted and the
  // anchor recorded instead, so the assertions are on the blob, the object URL
  // and the `download` attribute.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExportButtons', () => {
  it('offers both CSVs, the JSON and the methods paragraph', () => {
    render(<ExportButtons result={result} />);
    expect(screen.getByRole('button', { name: SUMMARY_BUTTON })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: POSITION_BUTTON })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy methods paragraph' })).toBeInTheDocument();
  });

  it.each([
    [SUMMARY_BUTTON, 'assay-drift-sars-cov-2-2021-03-02-summary.csv'],
    [POSITION_BUTTON, 'assay-drift-sars-cov-2-2021-03-02-positions.csv'],
    ['Download JSON', 'assay-drift-sars-cov-2-2021-03-02.json'],
  ])('names the file after the pathogen and the result date: %s', async (label, filename) => {
    render(<ExportButtons result={result} />);
    await userEvent.click(screen.getByRole('button', { name: label }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe(filename);
    expect(clicked[0]!.href).toBe(handed[0]!.url);
  });

  it("stamps the file with the result's date, never with today", async () => {
    render(<ExportButtons result={result} />);
    await userEvent.click(screen.getByRole('button', { name: SUMMARY_BUTTON }));

    const today = new Date().toISOString().slice(0, 10);
    expect(today).not.toBe('2021-03-02');
    expect(clicked[0]!.download).toContain('2021-03-02');
    expect(clicked[0]!.download).not.toContain(today);
  });

  it('hands over a CSV whose first line is the unit of analysis', async () => {
    render(<ExportButtons result={result} />);
    await userEvent.click(screen.getByRole('button', { name: SUMMARY_BUTTON }));

    const blob = handed[0]!.blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    // The bytes start with a UTF-8 BOM, so Excel on Windows does not mangle the
    // non-ASCII characters in the comment header. `Blob.text()` runs a
    // BOM-stripping UTF-8 decode, so the mark has to be checked on the bytes
    // and the first line on the decoded text.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const contents = await blob.text();
    expect(contents.startsWith(`# ${UNIT_OF_ANALYSIS}`)).toBe(true);
    expect(contents).toContain('Alpha S-gene window,forward,main,21765,21786,plus,71142,70387');
  });

  it('hands over the position CSV, one row per position', async () => {
    render(<ExportButtons result={result} />);
    await userEvent.click(screen.getByRole('button', { name: POSITION_BUTTON }));

    // `Blob.text()` strips the leading BOM for us.
    const contents = await handed[0]!.blob.text();
    const rows = contents.split('\r\n').filter((line) => line !== '' && !line.startsWith('#'));
    expect(rows).toHaveLength(1 + 22);
  });

  it('hands over parsable JSON', async () => {
    render(<ExportButtons result={result} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download JSON' }));

    const blob = handed[0]!.blob;
    expect(blob.type).toBe('application/json;charset=utf-8');
    const parsed = JSON.parse(await blob.text()) as Record<string, unknown>;
    expect(parsed['methods']).toBe(methodsParagraph(result));
  });

  it('revokes every object URL it creates', async () => {
    render(<ExportButtons result={result} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download JSON' }));

    await waitFor(() => {
      expect(revoked).toEqual([handed[0]!.url]);
    });
  });
});

describe('ExportButtons — copying the methods paragraph', () => {
  it('mounts the live region before there is anything to announce', () => {
    render(<ExportButtons result={result} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('copies the paragraph and says so', async () => {
    const written: string[] = [];
    install(window.navigator, 'clipboard', {
      writeText: async (value: string) => {
        written.push(value);
      },
    });

    render(<ExportButtons result={result} />);
    // `fireEvent`, not `userEvent`: user-event installs its own clipboard stub
    // on setup, which would replace the one this test is watching.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy methods paragraph' }));
    });

    expect(written).toEqual([methodsParagraph(result)]);
    expect(await screen.findByText('Methods paragraph copied.')).toBeInTheDocument();
  });

  it('says so, without throwing, when there is no clipboard', async () => {
    install(window.navigator, 'clipboard', undefined);

    render(<ExportButtons result={result} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy methods paragraph' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent(/could not reach the clipboard/i);
  });
});

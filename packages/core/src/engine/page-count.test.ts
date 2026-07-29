import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countPdfPages, PageCountError } from './page-count';
import { probeTextLayer } from './text-layer-probe';
import { syntheticPdf } from './__fixtures__/synthetic-pdf';

const fixtureBytes = readFileSync(
  fileURLToPath(new URL('./__fixtures__/born-digital.pdf', import.meta.url)),
);
const fixture = () => new Uint8Array(fixtureBytes);

describe('countPdfPages (Story 5.2)', () => {
  it('reads the page count from a real PDF', async () => {
    expect(await countPdfPages(fixture())).toBe(1);
  });

  it.each([1, 2, 25, 26, 201])('reads %i pages back from a %i-page document', async (pageCount) => {
    // A one-page fixture cannot tell `numPages` from a hardcoded 1, and 25/26
    // are exactly where Story 5.2's free cap decides.
    expect(await countPdfPages(syntheticPdf(pageCount))).toBe(pageCount);
  });

  it('does NOT detach the caller’s bytes — the probe still works afterwards', async () => {
    // The failure this guards is silent and total: pdf.js detaches the buffer it
    // is handed, so a page count taken without copying leaves the router with an
    // empty document and every subsequent conversion reports "unreadable".
    const bytes = fixture();
    await countPdfPages(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(await probeTextLayer(bytes)).toBe('born-digital');
  });

  it('throws PageCountError on bytes that are not a PDF', async () => {
    await expect(countPdfPages(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(PageCountError);
  });

  it('names the page count in the failure, so a caller can tell it from a conversion error', async () => {
    await expect(countPdfPages(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/page count/i);
  });
});

/**
 * PDF page count, read from the document's own structure before any provider
 * call (Story 5.2).
 *
 * This lives in `core` for one reason: `core` is the only thing in the
 * repository that parses a PDF. `apps/hub` needs the number to enforce the free
 * page cap, and `apps/selfhost` does not need it at all — but adding a second
 * PDF parser to an app so that one envelope can count pages is the duplication
 * that drifts, and it is the same argument that keeps `unpdf` out of both apps
 * today.
 *
 * `core` learns nothing about quota by having this (AD-1). A page count is a
 * property of a document; that 25 of them is where the free tier stops is a
 * policy, and it lives in `apps/hub/lib/quota-policy.ts`.
 *
 * **Cost note.** This is the same cheap local parse the text-layer probe does
 * (AD-15) — no provider call, no OCR. That is what lets the caller enforce a
 * page cap *before* paying for the pages, which is what `quota-economics.md`
 * means by "page count detected from PDF metadata before OCR".
 */
import { getDocumentProxy } from 'unpdf';
import { getCachedPdfPageCount, setCachedPdfPageCount } from './text-layer-probe';

/**
 * A PDF whose page count could not be read: corrupt, encrypted, or not a PDF at
 * all.
 *
 * A distinct class rather than a bare `Error` so a caller can map it to its own
 * curated copy without matching on a message string — the hub turns it into the
 * localized "we can't read this file" refusal, which is a 4xx, not the 502 a
 * generic failure would produce.
 */
export class PageCountError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PageCountError';
  }
}

/**
 * How many pages a PDF has.
 *
 * The bytes are **copied** before being handed to pdf.js, which detaches the
 * `ArrayBuffer` it is given. Without the copy the caller's `Uint8Array` would be
 * empty for the extraction that follows — the same trap `probeTextLayer`
 * documents, and it bites harder here because this runs first.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const cached = getCachedPdfPageCount(bytes);
  if (cached !== undefined) return cached;

  let pages: number;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    pages = pdf.numPages;
  } catch (cause) {
    throw new PageCountError(
      `Could not read the PDF page count: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  // pdf.js reports `numPages` from the catalog; a document that parsed but
  // claims zero (or a non-integer) pages is not something to pass on as a
  // number a cap will be compared against.
  if (!Number.isInteger(pages) || pages < 1) {
    throw new PageCountError(`The PDF reports an impossible page count (${String(pages)}).`);
  }
  setCachedPdfPageCount(bytes, pages);
  return pages;
}

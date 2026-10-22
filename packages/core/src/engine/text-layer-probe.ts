/**
 * Cheap PDF text-layer probe (AD-15): classifies a PDF born-digital vs
 * image-only before any provider call (cost ~0 — text is already embedded for
 * born-digital PDFs). Routing uses this to reserve scan-OCR for what needs it.
 */
import { extractText, getDocumentProxy } from 'unpdf';

export type TextLayerVerdict = 'born-digital' | 'image-only' | 'ambiguous';

export interface PdfTextLayerInspection {
  verdict: TextLayerVerdict;
  pages: number;
  pageTexts: string[];
}

/** Non-whitespace chars above which a PDF is treated as born-digital. */
const BORN_DIGITAL_MIN_CHARS = 100;

/**
 * Per-request in-memory cache keyed by the `Uint8Array` instance (AD-7 zero
 * retention: `WeakMap` entries are garbage-collected automatically as soon as
 * the request's byte buffer is released). Prevents `countPdfPages`,
 * `probeTextLayer`, `JinaReaderAdapter` and `LocalPdfReaderAdapter` from
 * calling `getDocumentProxy(new Uint8Array(bytes))` multiple times on the same
 * PDF within a single conversion.
 */
const inspectionCache = new WeakMap<Uint8Array, PdfTextLayerInspection>();
const pageCountCache = new WeakMap<Uint8Array, number>();

export function getCachedPdfPageCount(bytes: Uint8Array): number | undefined {
  return inspectionCache.get(bytes)?.pages ?? pageCountCache.get(bytes);
}

export function setCachedPdfPageCount(bytes: Uint8Array, pages: number): void {
  pageCountCache.set(bytes, pages);
}

/**
 * Inspect a PDF's embedded text layer and page count in a single `unpdf` pass.
 */
export async function inspectPdfTextLayer(bytes: Uint8Array): Promise<PdfTextLayerInspection> {
  const cached = inspectionCache.get(bytes);
  if (cached) return cached;

  let pageTexts: string[];
  let pages: number;
  let hasRealNumPages = false;
  try {
    // pdf.js DETACHES the ArrayBuffer it is handed — pass a copy so the caller's
    // bytes survive for the subsequent extract() call (the router reuses them).
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    pageTexts = Array.isArray(text) ? text.map((t) => t ?? '') : [text ?? ''];
    const rawNumPages = (pdf as { numPages?: unknown }).numPages;
    if (typeof rawNumPages === 'number' && Number.isInteger(rawNumPages) && rawNumPages >= 1) {
      pages = rawNumPages;
      hasRealNumPages = true;
    } else if (typeof totalPages === 'number' && Number.isInteger(totalPages) && totalPages >= 1) {
      pages = totalPages;
    } else {
      pages = Math.max(pageTexts.length, 1);
    }
  } catch (cause) {
    // A corrupt/encrypted PDF is an explicit error — never a silent "image-only".
    throw new Error(
      `Could not read the PDF text layer: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  const extracted = pageTexts.join('\n');
  const meaningful = extracted.replace(/\s+/g, '').length;
  const verdict: TextLayerVerdict =
    meaningful >= BORN_DIGITAL_MIN_CHARS
      ? 'born-digital'
      : meaningful > 0
        ? 'ambiguous' // a little text → route to OCR (AD-15 safety)
        : 'image-only';

  const result: PdfTextLayerInspection = { verdict, pages, pageTexts };
  if (hasRealNumPages) {
    inspectionCache.set(bytes, result);
    pageCountCache.set(bytes, pages);
  }
  return result;
}

export async function probeTextLayer(bytes: Uint8Array): Promise<TextLayerVerdict> {
  const { verdict } = await inspectPdfTextLayer(bytes);
  return verdict;
}

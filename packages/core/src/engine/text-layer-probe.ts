/**
 * Cheap PDF text-layer probe (AD-15): classifies a PDF born-digital vs
 * image-only before any provider call (cost ~0 — text is already embedded for
 * born-digital PDFs). Routing uses this to reserve scan-OCR for what needs it.
 */
import { extractText, getDocumentProxy } from 'unpdf';

export type TextLayerVerdict = 'born-digital' | 'image-only' | 'ambiguous';

/** Non-whitespace chars above which a PDF is treated as born-digital. */
const BORN_DIGITAL_MIN_CHARS = 100;

export async function probeTextLayer(bytes: Uint8Array): Promise<TextLayerVerdict> {
  let extracted: string;
  try {
    // pdf.js DETACHES the ArrayBuffer it is handed — pass a copy so the caller's
    // bytes survive for the subsequent extract() call (the router reuses them).
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    extracted = Array.isArray(text) ? text.join('\n') : (text ?? '');
  } catch (cause) {
    // A corrupt/encrypted PDF is an explicit error — never a silent "image-only".
    throw new Error(
      `Could not read the PDF text layer: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  const meaningful = extracted.replace(/\s+/g, '').length;
  if (meaningful >= BORN_DIGITAL_MIN_CHARS) return 'born-digital';
  if (meaningful > 0) return 'ambiguous'; // a little text → route to OCR (AD-15 safety)
  return 'image-only';
}

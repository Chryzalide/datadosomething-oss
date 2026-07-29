/**
 * Engine router (AD-15): probes the PDF text layer, then routes to the cheapest
 * correct engine with graceful fallback. Pure orchestration over injected
 * engines — it imports the port, never a concrete adapter, so apps compose the
 * engines and `core` stays swappable.
 */
import type { DocumentModel } from '../document-model';
import { type DocumentEngine, type EngineSource, NoEngineAvailableError } from './port';
import { probeTextLayer, type TextLayerVerdict } from './text-layer-probe';

export interface EngineRegistry {
  reader?: DocumentEngine;
  ocr?: DocumentEngine;
}

export class EngineRouter {
  constructor(private readonly engines: EngineRegistry) {}

  async route(source: EngineSource): Promise<DocumentModel> {
    // An uploaded image has no PDF text layer to probe — route straight to OCR.
    if (source.kind === 'image') {
      if (this.engines.ocr) return this.engines.ocr.extract(source);
      throw new NoEngineAvailableError(
        'No OCR engine is configured to read this image. ' +
          'Configure an OCR key (Mistral) to convert scanned images.',
      );
    }

    let verdict: TextLayerVerdict;
    try {
      verdict = await probeTextLayer(source.bytes);
    } catch (cause) {
      // The probe couldn't read the PDF (corrupt/encrypted). An OCR engine may
      // still serve it (image-only path); otherwise surface the explicit error.
      if (this.engines.ocr) return this.engines.ocr.extract(source);
      throw cause;
    }

    // born-digital → reader (cheap), fall back to OCR.
    // image-only / ambiguous → OCR, fall back to reader only if that's all there is.
    const preferred =
      verdict === 'born-digital'
        ? [this.engines.reader, this.engines.ocr]
        : [this.engines.ocr, this.engines.reader];

    const engine = preferred.find((candidate): candidate is DocumentEngine => candidate != null);
    if (!engine) {
      throw new NoEngineAvailableError(
        `No engine is configured to read this ${verdict} PDF. ` +
          `Configure a reader key (Jina) for born-digital PDFs or an OCR key (Mistral) for scans.`,
      );
    }
    return engine.extract(source);
  }
}

/**
 * Local PDF reader adapter (AD-2 / AD-15) — extracts embedded text from a
 * born-digital PDF locally via `unpdf` (`extractText(pdf, { mergePages: false })`)
 * with zero external API calls, zero cost, and exact per-page provenance
 * (`page: 1..N`).
 *
 * Usable either as the primary `reader` engine in 100% local/offline setups or
 * as the `localReader` fallback in `EngineRouter` before falling back to paid
 * scan OCR when no remote reader key (`JINA_API_KEY`) is configured.
 */
import { type Block, createDocument, type DocumentModel } from '../../document-model';
import { markdownToDocument } from '../markdown-to-document';
import { type DocumentEngine, type EngineSource } from '../port';
import { inspectPdfTextLayer } from '../text-layer-probe';

export const LOCAL_PDF_READER_PROVIDER = 'local-pdf';

export interface LocalPdfReaderConfig {
  /** Optional custom provider identifier (defaults to `'local-pdf'`). */
  name?: string;
}

export class LocalPdfReaderAdapter implements DocumentEngine {
  readonly kind = 'reader';
  readonly name: string;

  constructor(config: LocalPdfReaderConfig = {}) {
    this.name = config.name ?? LOCAL_PDF_READER_PROVIDER;
  }

  async extract(source: EngineSource): Promise<DocumentModel> {
    if (source.kind !== 'pdf') {
      throw new Error(
        'Local PDF reader can only extract from PDF sources, not raster images. Configure an OCR engine for images.',
      );
    }

    const { pages, pageTexts } = await inspectPdfTextLayer(source.bytes);
    const blocks: Block[] = [];

    pageTexts.forEach((pageText, position) => {
      if (typeof pageText !== 'string' || pageText.trim() === '') return;
      const pageNumber = position + 1;
      const pageModel = markdownToDocument(pageText, {
        type: 'pdf',
        pages,
        provider: this.name,
      });
      for (const block of pageModel.blocks) {
        blocks.push({ ...block, page: pageNumber });
      }
    });

    if (blocks.length === 0) {
      throw new Error('Local PDF reader returned empty content for this PDF.');
    }

    return createDocument({ type: 'pdf', pages, provider: this.name }, blocks);
  }
}

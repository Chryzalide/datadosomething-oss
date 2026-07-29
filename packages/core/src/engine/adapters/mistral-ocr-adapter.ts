/**
 * Mistral OCR adapter (AD-2/AD-15) — the scanned/image OCR engine. Calls the
 * Mistral OCR HTTP API via `fetch` (NO `@mistralai` SDK, so the AD-1 boundary
 * gate stays green) and maps its per-page Markdown into the canonical Document
 * Model — the SAME pivot the reader path uses, so `renderMarkdown` produces
 * output identical in structure to the digital path (FR-3 parity).
 *
 * Mistral OCR: POST https://api.mistral.ai/v1/ocr with JSON
 *   { model, document: { type: 'document_url'|'image_url', <url>: 'data:…;base64,…' }, include_image_base64: false }
 *   Authorization: Bearer <key>, Accept: application/json
 *   → { pages: [{ index, markdown }, …] }.
 * Keys are injected (BYO-keys); `core` never reads process.env.
 *
 * **Two callers, one pivot (Story 5.8).** This adapter makes the in-request
 * interactive call; `apps/hub` submits large scanned M-tier jobs to Mistral OCR
 * **Batch** and receives the *same* envelope hours later, out of a downloaded
 * result file. Mapping it there too would be a second implementation of an
 * envelope parser, and two copies of one drift — so the mapping is exported as
 * `mistralOcrEnvelopeToDocument` and `extract` is its first caller. The async
 * orchestration stays in `apps/hub` (AD-16); what `core` contributes is this
 * function, which is synchronous and pure, exactly as AD-16 requires of `core`.
 */
import { type Block, createDocument, type DocumentModel } from '../../document-model';
import { markdownToDocument } from '../markdown-to-document';
import {
  type DocumentEngine,
  EngineAuthError,
  EngineConfigError,
  type EngineSource,
  isAuthStatus,
} from '../port';

export interface MistralOcrConfig {
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Override the endpoint (tests / self-host mirrors). */
  baseUrl?: string;
  /** OCR model id (a dated alias may be pinned at bind). */
  model?: string;
  /** Request timeout in ms (default 120s) — OCR is slower than the reader. */
  timeoutMs?: number;
}

interface MistralOcrEnvelope {
  pages?: Array<{ index?: unknown; markdown?: unknown }>;
}

/** The engine name both paths stamp on the Document's source. One constant, so a
 *  batch-delivered Sortie and a realtime one cannot disagree about provenance. */
export const MISTRAL_OCR_PROVIDER = 'mistral-ocr';

/**
 * Map a Mistral OCR response envelope to the canonical Document Model.
 *
 * Pure and synchronous: it takes the parsed JSON and the kind of source it came
 * from, and returns a Document. No `fetch`, no key, no vendor client — which is
 * what lets `apps/hub` reuse it for a Batch result that arrives through an
 * entirely different transport (Story 5.8, AD-16) without either path being able
 * to drift from the other.
 *
 * Each page's Markdown goes through the SHARED mapper (AD-3: one pivot), then
 * each block's page is re-stamped with the real 1-based page number so the JSON
 * renderer (Story 2.1) keeps per-page provenance. Rendering structure is
 * identical to the digital path because the model + `renderMarkdown` are shared.
 *
 * `payload` is `unknown` on purpose: the batch path reads it out of a downloaded
 * file rather than out of a response this package issued, so it is untrusted in
 * a way `extract`'s own body was not.
 */
export function mistralOcrEnvelopeToDocument(
  payload: unknown,
  source: { kind: 'pdf' | 'image' },
): DocumentModel {
  const pages = (payload as MistralOcrEnvelope | null | undefined)?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('Mistral OCR returned an unexpected response (missing pages).');
  }

  const blocks: Block[] = [];
  let stringPages = 0;
  pages.forEach((page, position) => {
    if (typeof page?.markdown !== 'string') return;
    stringPages += 1;
    const pageNumber = typeof page.index === 'number' ? page.index + 1 : position + 1;
    const pageModel = markdownToDocument(page.markdown, {
      type: source.kind,
      pages: pages.length,
      provider: MISTRAL_OCR_PROVIDER,
    });
    for (const block of pageModel.blocks) blocks.push({ ...block, page: pageNumber });
  });

  if (stringPages === 0) {
    throw new Error('Mistral OCR returned no readable page content for this document.');
  }

  return createDocument(
    { type: source.kind, pages: pages.length, provider: MISTRAL_OCR_PROVIDER },
    blocks,
  );
}

export class MistralOcrAdapter implements DocumentEngine {
  readonly kind = 'ocr';
  readonly name = MISTRAL_OCR_PROVIDER;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: MistralOcrConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new EngineConfigError('No Mistral API key configured. Set MISTRAL_API_KEY.');
    }
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = config.baseUrl ?? 'https://api.mistral.ai/v1/ocr';
    this.model = config.model ?? 'mistral-ocr-latest';
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async extract(source: EngineSource): Promise<DocumentModel> {
    const base64 = Buffer.from(source.bytes).toString('base64');
    const document =
      source.kind === 'image'
        ? { type: 'image_url', image_url: `data:${source.mimeType};base64,${base64}` }
        : { type: 'document_url', document_url: `data:application/pdf;base64,${base64}` };

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ model: this.model, document, include_image_base64: false }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const reason =
        cause instanceof Error && cause.name === 'TimeoutError'
          ? `timed out after ${this.timeoutMs}ms`
          : `network error (${cause instanceof Error ? cause.message : String(cause)})`;
      throw new Error(`Mistral OCR request failed — ${reason}.`, { cause });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // A refused credential is a CONFIG problem, not a conversion failure.
      if (isAuthStatus(response.status)) {
        throw new EngineAuthError(
          `Mistral rejected the API key (HTTP ${response.status}). Check MISTRAL_API_KEY.`,
        );
      }
      throw new Error(`Mistral OCR request failed (HTTP ${response.status}). ${detail}`.trim());
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new Error('Mistral OCR returned a non-JSON response.', { cause });
    }

    // The mapping is shared with the Batch path in `apps/hub` (Story 5.8) — see
    // the note on the function. Nothing about it is specific to having just made
    // the request.
    return mistralOcrEnvelopeToDocument(payload, { kind: source.kind });
  }
}

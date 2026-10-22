/**
 * Jina Reader adapter (AD-2/AD-15) — the born-digital reader engine. Calls the
 * Jina Reader HTTP API via `fetch` (NO vendor SDK, so the AD-1 boundary gate
 * stays green) and maps the returned Markdown into the canonical Document Model.
 *
 * Jina Reader: POST https://r.jina.ai/ with multipart `file` = PDF bytes,
 * `Authorization: Bearer <key>`, `Accept: application/json`,
 * `X-Respond-With: markdown` → `{ data: { content: <markdown> } }`.
 * Keys are injected (BYO-keys); `core` never reads process.env.
 */
import type { DocumentModel } from '../../document-model';
import { fetchWithRetry, type HttpRetryOptions } from '../../http-retry';
import { markdownToDocument } from '../markdown-to-document';
import { countPdfPages } from '../page-count';
import {
  type DocumentEngine,
  EngineAuthError,
  EngineConfigError,
  type EngineSource,
  isAuthStatus,
} from '../port';

export interface JinaReaderConfig {
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Override the endpoint (tests / self-host mirrors). */
  baseUrl?: string;
  /** Request timeout in ms (default 60s) — bounds a hung Jina response. */
  timeoutMs?: number;
  /** Bounded retry options on transient HTTP 429/502/503/504, or `false` to disable. */
  retry?: HttpRetryOptions | false;
}

interface JinaEnvelope {
  data?: { content?: unknown };
}

export class JinaReaderAdapter implements DocumentEngine {
  readonly kind = 'reader';
  readonly name = 'jina-reader';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: JinaReaderConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new EngineConfigError('No Jina API key configured. Set JINA_API_KEY.');
    }
    this.apiKey = config.apiKey;
    const rawFetch = config.fetch ?? fetch;
    const retryOptions: HttpRetryOptions | false =
      config.retry === false
        ? false
        : {
            baseDelayMs: config.fetch ? 0 : 250,
            ...config.retry,
          };
    this.fetchImpl = fetchWithRetry(rawFetch, retryOptions);
    this.baseUrl = config.baseUrl ?? 'https://r.jina.ai/';
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async extract(source: EngineSource): Promise<DocumentModel> {
    const form = new FormData();
    // Cast the view's buffer generic so this compiles under both the Node lib
    // (core's own ES2023 context) and the DOM lib (a consumer app like apps/hub,
    // whose stricter BlobPart rejects Uint8Array<ArrayBufferLike>).
    const blob = new Blob([source.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    form.append('file', blob, source.filename ?? 'document.pdf');

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'X-Respond-With': 'markdown',
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const reason =
        cause instanceof Error && cause.name === 'TimeoutError'
          ? `timed out after ${this.timeoutMs}ms`
          : `network error (${cause instanceof Error ? cause.message : String(cause)})`;
      throw new Error(`Jina Reader request failed — ${reason}.`, { cause });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // A refused credential is a CONFIG problem, not a conversion failure: it
      // names the variable so the operator knows what to fix (FR-14, UX-DR10).
      if (isAuthStatus(response.status)) {
        throw new EngineAuthError(
          `Jina rejected the API key (HTTP ${response.status}). Check JINA_API_KEY.`,
        );
      }
      throw new Error(`Jina Reader request failed (HTTP ${response.status}). ${detail}`.trim());
    }

    let payload: JinaEnvelope;
    try {
      payload = (await response.json()) as JinaEnvelope;
    } catch (cause) {
      throw new Error('Jina Reader returned a non-JSON response.', { cause });
    }

    const markdown = payload.data?.content;
    if (typeof markdown !== 'string') {
      throw new Error('Jina Reader returned an unexpected response (missing data.content).');
    }
    if (markdown.trim() === '') {
      throw new Error('Jina Reader returned empty content for this PDF.');
    }

    let pages = 1;
    if (source.kind === 'pdf') {
      try {
        pages = await countPdfPages(source.bytes);
      } catch {
        pages = 1;
      }
    }
    return markdownToDocument(markdown, { type: 'pdf', pages, provider: this.name });
  }
}

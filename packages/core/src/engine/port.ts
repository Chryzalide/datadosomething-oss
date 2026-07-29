/**
 * The extraction provider port (AD-2) — the vendor-neutral boundary the engine
 * router (AD-15) fronts. `core` depends only on this interface; concrete
 * adapters (JinaReaderAdapter, MistralOcrAdapter…) implement it and carry the
 * vendor name. No provider name appears in these identifiers.
 */
import type { DocumentModel } from '../document-model';

/** Which kind of engine an adapter is — the router routes by this + the probe. */
export type EngineKind = 'reader' | 'ocr';

/** An ingest source. V1 is uploaded PDF bytes; the remote-URL source is Story 1.7. */
export interface PdfSource {
  kind: 'pdf';
  bytes: Uint8Array;
  filename?: string;
}

/** A scanned-image ingest source (PNG/JPG) — routed straight to OCR (Story 1.6). */
export interface ImageSource {
  kind: 'image';
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  filename?: string;
}

export type EngineSource = PdfSource | ImageSource;

/** A provider adapter: turns a source into the canonical Document Model. */
export interface DocumentEngine {
  readonly kind: EngineKind;
  /** Stable engine identity (a runtime value, e.g. "jina-reader"). */
  readonly name: string;
  extract(source: EngineSource): Promise<DocumentModel>;
}

/** A required provider key/config is missing or invalid (FR-14). */
export class EngineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineConfigError';
  }
}

/**
 * A provider REJECTED the supplied credential (HTTP 401/403) — the key exists
 * but is wrong, expired, or lacks the needed scope (FR-14, UX-DR10).
 *
 * Extends `EngineConfigError` deliberately: every caller that already maps a
 * config problem to an explicit, actionable response (`apps/hub`'s 503 branch,
 * `apps/selfhost`'s converter) picks this up with no new branching, and an
 * `instanceof EngineConfigError` check keeps meaning "the operator has something
 * to fix". Adapters supply the message and name the env var; no vendor type
 * appears here (AD-2).
 *
 * Distinguishing this from a generic failure is what lets an operator tell a bad
 * key from a provider outage — the whole point of Story 4.2's AC1.
 */
export class EngineAuthError extends EngineConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'EngineAuthError';
  }
}

/** HTTP statuses that mean "your credential was refused", not "we failed". */
export function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/** No registered engine can serve the source (AR-4 refuse-only-when-none). */
export class NoEngineAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoEngineAvailableError';
  }
}

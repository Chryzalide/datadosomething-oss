/**
 * `@datadosomething/core` — the pure engine (Moteur).
 *
 * AD-1: this package has ZERO knowledge of quota, ads, Stripe, accounts, or the
 * marketing hub, and never imports an app, a DB client, a payment/ads SDK, or a
 * vendor OCR/LLM SDK. It talks to the outside world only through ports
 * (interfaces) introduced in later stories.
 *
 * Naming convention: no provider name ever appears in core identifiers — adapters
 * (added later) carry the vendor name (e.g. `MistralOcrAdapter`), not core.
 */

/** Stable package identity, useful for smoke-checking the in-process wiring. */
export const CORE_PACKAGE = '@datadosomething/core' as const;

/** Current SemVer release of `@datadosomething/core`, kept in lockstep with `package.json`. */
export const CORE_VERSION = '1.1.1' as const;

/** Current SemVer release of the engine. */
export function coreVersion(): string {
  return CORE_VERSION;
}

// The canonical Document Model (AD-3 / AD-4) and its renderers.
export {
  DOCUMENT_MODEL_VERSION,
  createDocument,
  type BBox,
  type Block,
  type BlockType,
  type CodeBlock,
  type DocumentModel,
  type DocumentSource,
  type HeadingBlock,
  type ListBlock,
  type ParagraphBlock,
  type TableBlock,
} from './document-model';
export { renderMarkdown } from './renderers/markdown';
export {
  PDFTOJSON_SCHEMA_VERSION,
  projectToJson,
  renderJson,
  type JsonBBox,
  type JsonBlock,
  type JsonCodeBlock,
  type JsonDocument,
  type JsonHeadingBlock,
  type JsonListBlock,
  type JsonParagraphBlock,
  type JsonSource,
  type JsonTableBlock,
} from './renderers/json';
export { PDFTOJSON_JSON_SCHEMA } from './renderers/pdftojson-schema';

// Engine: ports & adapters + the router (AD-2 / AD-15).
export {
  type DocumentEngine,
  type EngineKind,
  type EngineSource,
  EngineAuthError,
  EngineConfigError,
  isAuthStatus,
  type ImageSource,
  NoEngineAvailableError,
  type PdfSource,
} from './engine/port';
export { EngineRouter, type EngineRegistry } from './engine/router';
export {
  inspectPdfTextLayer,
  type PdfTextLayerInspection,
  probeTextLayer,
  type TextLayerVerdict,
} from './engine/text-layer-probe';
export { countPdfPages, PageCountError } from './engine/page-count';
export { markdownToDocument } from './engine/markdown-to-document';
export { JinaReaderAdapter, type JinaReaderConfig } from './engine/adapters/jina-reader-adapter';
export {
  LOCAL_PDF_READER_PROVIDER,
  LocalPdfReaderAdapter,
  type LocalPdfReaderConfig,
} from './engine/adapters/local-pdf-reader-adapter';
export {
  MISTRAL_OCR_PROVIDER,
  MistralOcrAdapter,
  type MistralOcrConfig,
  // The envelope→Document pivot, shared with the hub's Batch delivery path
  // (Story 5.8, AD-16). Pure and synchronous; the async orchestration is not here.
  mistralOcrEnvelopeToDocument,
} from './engine/adapters/mistral-ocr-adapter';
export {
  computeRetryDelayMs,
  fetchWithRetry,
  type HttpRetryOptions,
  isRetryableStatus,
  parseRetryAfterMs,
} from './http-retry';
export { convertToDocument, convertToJson, convertToMarkdown } from './pipeline';

// Nettoyage: the LLM port (AD-2) + stage 1, the deterministic rule pass (AD-8).
// Stages 2 (bounded LLM pass) and 3 (verifier) land in Story 3.2; app wiring in 3.3.
export {
  type LlmCompletionRequest,
  LlmConfigError,
  type LlmProvider,
  NETTOYAGE_REASONING_EFFORT,
  NETTOYAGE_TEMPERATURE,
} from './nettoyage/llm-port';
export {
  NETTOYAGE_WHITESPACE,
  OCR_ARTIFACT_CHARS,
  ruleCleanCodeText,
  ruleCleanDocument,
  ruleCleanText,
} from './nettoyage/rule-pass';
export {
  MistralSmallAdapter,
  type MistralSmallConfig,
} from './nettoyage/adapters/mistral-small-adapter';
// Nettoyage stages 2 + 3 and the 3-stage orchestrator (Story 3.2).
export { flattenTexts, textCount, withTexts } from './nettoyage/document-texts';
export {
  type LlmPassFailure,
  type LlmPassOptions,
  type LlmPassResult,
  NETTOYAGE_SYSTEM_PROMPT,
  runLlmCleanupPass,
} from './nettoyage/llm-pass';
export {
  NETTOYAGE_REMOVABLE_NOISE,
  type NettoyageRejectionReason,
  type NettoyageSlotRejection,
  type NettoyageVerdict,
  protectedProjection,
  reconcileCleanedTexts,
  type ReconciledTextsResult,
  verifyCleanedDocument,
  verifyCleanedText,
} from './nettoyage/verifier';
export {
  cleanDocument,
  type NettoyageOutcome,
  type NettoyageResult,
  ruleOnlyResult,
} from './nettoyage/nettoyage';

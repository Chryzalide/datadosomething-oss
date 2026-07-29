/**
 * Thin composition helpers so a caller (the Story 1.5 hub page) can go from PDF
 * bytes to a Document Model / Markdown with an injected engine registry. Keeps
 * the wiring in `core` while the app supplies the (BYO) keys and engines.
 */
import type { DocumentModel } from './document-model';
import { type EngineRegistry, EngineRouter } from './engine/router';
import type { EngineSource } from './engine/port';
import { renderMarkdown } from './renderers/markdown';
import { renderJson } from './renderers/json';

/** Route a source through the engines to the canonical Document Model. */
export async function convertToDocument(
  source: EngineSource,
  engines: EngineRegistry,
): Promise<DocumentModel> {
  return new EngineRouter(engines).route(source);
}

/** Route a source and project the resulting model to Markdown (pdftomd). */
export async function convertToMarkdown(
  source: EngineSource,
  engines: EngineRegistry,
): Promise<string> {
  return renderMarkdown(await convertToDocument(source, engines));
}

/** Route a source and project the resulting model to pdftojson JSON (pdftojson). */
export async function convertToJson(
  source: EngineSource,
  engines: EngineRegistry,
): Promise<string> {
  return renderJson(await convertToDocument(source, engines));
}

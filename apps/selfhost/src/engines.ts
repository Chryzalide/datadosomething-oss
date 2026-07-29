import { type EngineRegistry, JinaReaderAdapter, MistralOcrAdapter } from '@datadosomething/core';

/**
 * Engine composition for the self-hosted envelope (AD-2 BYO-keys).
 *
 * The APP reads `process.env` and wires the concrete adapters; `packages/core`
 * never touches environment or vendor config — it receives an `EngineRegistry`
 * and stays pure (AD-1).
 *
 * This is a deliberate twin of `apps/hub/lib/engines.ts`, not an import of it:
 * `apps/selfhost` ships in the public OSS repo **without** the hub, so an import
 * would not resolve there, and AD-1 forbids the edge regardless.
 *
 * - `MISTRAL_API_KEY` → OCR path (scanned images, image-only PDFs).
 * - `JINA_API_KEY` (optional) → reader path (born-digital PDFs), the cheap route.
 *
 * With only a Mistral key, the router's graceful fallback (AR-4) still serves a
 * born-digital PDF via OCR rather than refusing it — Story 4.2 covers that
 * behaviour explicitly.
 */
export function composeEngines(
  env: Record<string, string | undefined> = process.env,
): EngineRegistry {
  const registry: EngineRegistry = {};

  const jinaKey = env.JINA_API_KEY?.trim();
  if (jinaKey) registry.reader = new JinaReaderAdapter({ apiKey: jinaKey });

  const mistralKey = env.MISTRAL_API_KEY?.trim();
  if (mistralKey) registry.ocr = new MistralOcrAdapter({ apiKey: mistralKey });

  return registry;
}

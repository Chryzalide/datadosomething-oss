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
function parsePositiveInt(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveOcrEndpoint(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  if (trimmed.endsWith('/ocr')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/ocr`;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === '' || parsed.pathname === '/') {
      return `${trimmed}/v1/ocr`;
    }
  } catch {
    // Pass through non-URL strings unchanged.
  }
  return trimmed;
}

export function composeEngines(
  env: Record<string, string | undefined> = process.env,
): EngineRegistry {
  const registry: EngineRegistry = {};

  const jinaKey = env.JINA_API_KEY?.trim();
  const readerBaseUrl = env.READER_BASE_URL?.trim();
  const readerTimeoutMs = parsePositiveInt(env.READER_TIMEOUT_MS);
  if (jinaKey) {
    registry.reader = new JinaReaderAdapter({
      apiKey: jinaKey,
      ...(readerBaseUrl ? { baseUrl: readerBaseUrl } : {}),
      ...(readerTimeoutMs !== undefined ? { timeoutMs: readerTimeoutMs } : {}),
    });
  }

  const mistralKey = env.MISTRAL_API_KEY?.trim();
  const ocrBaseUrl = resolveOcrEndpoint(env.OCR_BASE_URL);
  const ocrModel = env.OCR_MODEL?.trim();
  const ocrTimeoutMs = parsePositiveInt(env.OCR_TIMEOUT_MS);
  if (mistralKey) {
    registry.ocr = new MistralOcrAdapter({
      apiKey: mistralKey,
      ...(ocrBaseUrl ? { baseUrl: ocrBaseUrl } : {}),
      ...(ocrModel ? { model: ocrModel } : {}),
      ...(ocrTimeoutMs !== undefined ? { timeoutMs: ocrTimeoutMs } : {}),
    });
  }

  return registry;
}

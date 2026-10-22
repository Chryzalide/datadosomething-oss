/**
 * Bounded HTTP retry helper with exponential backoff and `Retry-After` support
 * for transient provider failures (`429`, `502`, `503`, `504`).
 *
 * Pure and vendor-neutral (AD-1 / AD-2): wraps a `fetch`-compatible function
 * without importing any vendor SDK.
 */

export interface HttpRetryOptions {
  /** Maximum number of retry attempts after the initial call (default: 2). */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds before the first retry (default: 250). */
  baseDelayMs?: number;
  /** Upper bound in milliseconds for any single retry delay, including `Retry-After` (default: 5000). */
  maxDelayMs?: number;
  /** Injectable sleep implementation for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 5_000;

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether an HTTP status represents a transient rate-limit or upstream gateway
 * outage worth retrying (`429`, `502`, `503`, `504`).
 *
 * Authentication failures (`401`, `403`) and client errors (`400`, `404`, `413`,
 * `415`, `422`) are never retried.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Parse an HTTP `Retry-After` header (either delay-seconds or an HTTP-date)
 * into a non-negative delay in milliseconds, or `undefined` if absent/invalid.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed === '') return undefined;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
  }

  const targetMs = Date.parse(trimmed);
  if (!Number.isNaN(targetMs)) {
    return Math.max(0, targetMs - nowMs);
  }

  return undefined;
}

/**
 * Compute the delay in milliseconds before retry `attempt` (0-indexed: `0` is
 * the first retry after the initial request).
 */
export function computeRetryDelayMs(
  attempt: number,
  response: Response | undefined,
  options: Required<Pick<HttpRetryOptions, 'baseDelayMs' | 'maxDelayMs'>>,
  nowMs: number = Date.now(),
): number {
  const retryAfterHeader = response?.headers?.get?.('retry-after');
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader, nowMs);
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, options.maxDelayMs);
  }
  const exponential = options.baseDelayMs * 2 ** attempt;
  return Math.min(exponential, options.maxDelayMs);
}

/**
 * Wrap a `fetch` implementation with bounded retries on `429`, `502`, `503`,
 * and `504` responses.
 */
export function fetchWithRetry(
  fetchImpl: typeof fetch,
  options: HttpRetryOptions | false = {},
): typeof fetch {
  if (options === false) return fetchImpl;

  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  if (maxRetries === 0) return fetchImpl;

  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(0, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const sleep = options.sleep ?? defaultSleep;

  return (async (...args: Parameters<typeof fetch>): Promise<Response> => {
    let attempt = 0;
    while (true) {
      const response = await fetchImpl(...args);
      if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
        return response;
      }
      // Drain and release the discarded response body so the underlying socket
      // can be reused cleanly without retaining buffer memory.
      await response.body?.cancel().catch(() => {});
      const delayMs = computeRetryDelayMs(attempt, response, { baseDelayMs, maxDelayMs });
      attempt += 1;
      await sleep(delayMs);
    }
  }) as typeof fetch;
}

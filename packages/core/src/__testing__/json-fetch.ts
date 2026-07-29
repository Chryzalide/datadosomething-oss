import { vi } from 'vitest';

/**
 * A stubbed `fetch` that replies with one canned JSON body.
 *
 * This used to exist three times — identically — in `jina-reader-adapter.test.ts`,
 * `mistral-ocr-adapter.test.ts` and `mistral-small-adapter.test.ts`, and each copy
 * was written as `vi.fn(async () => …)`. That gives the mock an **empty argument
 * tuple**, so every `fetchImpl.mock.calls[0][0]` in those files was reading a slot
 * the type system says cannot exist: the URL, the method, the headers and the body
 * assertions — the entire point of those tests — were unchecked. Nothing caught it
 * because `packages/core` excluded its test files from its own typecheck.
 *
 * Declaring the parameters as `typeof fetch` (the exact type the three adapters
 * accept for injection) is what makes `calls[0]` a real `[input, init?]` tuple,
 * and therefore what makes those assertions type-safe rather than merely present.
 *
 * Lives in `__testing__/` and is excluded from the emitted build: it is scaffolding
 * for the suite, not part of the distributed Apache-2.0 surface.
 */
export function jsonFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

import { defineConfig } from 'vitest/config';

/**
 * Vitest for the repo tooling in `scripts/` (Story 4.3).
 *
 * `scripts/` is not a workspace, so `pnpm -r test` never sees it, and until this
 * story the scripts there were untested by construction. Two of them now enforce
 * real rules — the AR-10 license gate and the public-repo split — which makes
 * "untested by construction" the wrong trade.
 *
 * **It lives here, not at the repo root, on purpose.** Vitest discovers its
 * config by walking *up* from the project directory, and `packages/core` has no
 * config of its own: a root `vitest.config.mjs` silently became core's config and
 * its `include` emptied core's 212-test suite down to "No test files found".
 * Keeping this file inside `scripts/` puts it outside every workspace's ancestry,
 * so it can never shadow one. Run it with `vitest run --root scripts`.
 */
export default defineConfig({
  test: {
    include: ['**/*.test.mjs'],
  },
});

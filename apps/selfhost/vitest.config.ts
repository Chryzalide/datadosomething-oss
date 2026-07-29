import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve the workspace core from source so unit tests need no prior build.
export default defineConfig({
  resolve: {
    alias: {
      '@datadosomething/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
    },
  },
});

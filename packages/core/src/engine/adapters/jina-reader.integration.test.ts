import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JinaReaderAdapter } from './jina-reader-adapter';
import { integrationApiKey, integrationSkipReason } from '../../__testing__/integration-gate';

/**
 * Gated real-API integration test: it hits the live Jina Reader API, so it runs
 * only under an explicit opt-in (see `integration-gate.ts`).
 */

const apiKey = integrationApiKey('JINA_API_KEY');
const fixture = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../__fixtures__/born-digital.pdf', import.meta.url))),
);

// The reason is in the suite NAME so a skipped run says why it skipped —
// silence is what made a placeholder key look like broken code.
describe(`JinaReaderAdapter — real Jina API (gated) [${integrationSkipReason('JINA_API_KEY')}]`, () => {
  it.skipIf(!apiKey)(
    'reads a born-digital PDF into a non-empty Document Model',
    async () => {
      const adapter = new JinaReaderAdapter({ apiKey: apiKey ?? '' });
      const doc = await adapter.extract({
        kind: 'pdf',
        bytes: fixture,
        filename: 'born-digital.pdf',
      });
      expect(doc.source.provider).toBe('jina-reader');
      expect(doc.blocks.length).toBeGreaterThan(0);
    },
    30_000,
  );
});

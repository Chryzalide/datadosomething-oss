import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MistralOcrAdapter } from './mistral-ocr-adapter';
import { integrationApiKey, integrationSkipReason } from '../../__testing__/integration-gate';

/**
 * Gated real-API integration test: it hits the live Mistral OCR API, so it runs
 * only under an explicit opt-in (see `integration-gate.ts`).
 */

const apiKey = integrationApiKey('MISTRAL_API_KEY');
const fixture = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../__fixtures__/scanned.png', import.meta.url))),
);

// The reason is in the suite NAME so a skipped run says why it skipped —
// silence is what made a placeholder key look like broken code.
describe(`MistralOcrAdapter — real Mistral OCR API (gated) [${integrationSkipReason('MISTRAL_API_KEY')}]`, () => {
  it.skipIf(!apiKey)(
    'reads a scanned PNG into a structured Document Model',
    async () => {
      const adapter = new MistralOcrAdapter({ apiKey: apiKey ?? '' });
      const doc = await adapter.extract({
        kind: 'image',
        bytes: fixture,
        mimeType: 'image/png',
        filename: 'scanned.png',
      });
      expect(doc.source.provider).toBe('mistral-ocr');
      expect(doc.source.type).toBe('image');
      expect(doc.blocks.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it.skipIf(!apiKey)(
    'numbers the first page 1 — the live check that `pages[].index` is 0-BASED',
    async () => {
      // Story 1.6's review deferred this as an open question: the adapter derives
      // `page` from `page.index + 1`, so if Mistral ever returned a 1-based index,
      // EVERY page number in every pdftojson Sortie would be off by one — silently,
      // because Markdown does not render page numbers and nothing compared the two.
      //
      // Probed against the live API on 2026-07-27: a one-page document comes back
      // with `index: 0`, so `+ 1` is correct and there is no bug to fix. This test
      // is what keeps that true. A one-page document must put every block on page 1;
      // if the provider switches to 1-based, this fails with `2` and names the cause.
      const adapter = new MistralOcrAdapter({ apiKey: apiKey ?? '' });
      const doc = await adapter.extract({
        kind: 'image',
        bytes: fixture,
        mimeType: 'image/png',
        filename: 'scanned.png',
      });

      expect(doc.source.pages).toBe(1);
      expect([...new Set(doc.blocks.map((block) => block.page))]).toEqual([1]);
    },
    60_000,
  );
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectPdfTextLayer, probeTextLayer } from './text-layer-probe';
import { syntheticPdf } from './__fixtures__/synthetic-pdf';

const fixture = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./__fixtures__/born-digital.pdf', import.meta.url))),
);

describe('probeTextLayer & inspectPdfTextLayer — real PDF (AC2, 1.2)', () => {
  it('classifies a real born-digital PDF as born-digital', async () => {
    expect(await probeTextLayer(fixture)).toBe('born-digital');
  });

  it('returns both { verdict, pages, pageTexts } from inspectPdfTextLayer', async () => {
    const inspection = await inspectPdfTextLayer(new Uint8Array(fixture));
    expect(inspection.verdict).toBe('born-digital');
    expect(inspection.pages).toBe(1);
    expect(inspection.pageTexts).toHaveLength(1);
    expect(inspection.pageTexts[0]).toContain('born-digital PDF fixture');

    const multiPage = await inspectPdfTextLayer(syntheticPdf(4));
    expect(multiPage.verdict).toBe('image-only');
    expect(multiPage.pages).toBe(4);
  });

  it('throws an explicit error on unreadable bytes (never a silent image-only)', async () => {
    await expect(probeTextLayer(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/text layer/i);
  });
});

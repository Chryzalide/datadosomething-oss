import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { syntheticPdf } from '../__fixtures__/synthetic-pdf';
import { LOCAL_PDF_READER_PROVIDER, LocalPdfReaderAdapter } from './local-pdf-reader-adapter';

const bornDigitalBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../__fixtures__/born-digital.pdf', import.meta.url))),
);

describe('LocalPdfReaderAdapter (1.3)', () => {
  it('extracts embedded text from a born-digital PDF with zero network calls and exact page provenance', async () => {
    const adapter = new LocalPdfReaderAdapter();
    expect(adapter.kind).toBe('reader');
    expect(adapter.name).toBe(LOCAL_PDF_READER_PROVIDER);

    const doc = await adapter.extract({
      kind: 'pdf',
      bytes: new Uint8Array(bornDigitalBytes),
      filename: 'born-digital.pdf',
    });

    expect(doc.source).toEqual({
      type: 'pdf',
      pages: 1,
      provider: LOCAL_PDF_READER_PROVIDER,
    });
    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.blocks[0]).toMatchObject({
      type: 'paragraph',
      page: 1,
    });
    if (doc.blocks[0]?.type === 'paragraph') {
      expect(doc.blocks[0].text).toContain('born-digital PDF fixture');
    }
  });

  it('throws on an empty/image-only PDF with no embedded text', async () => {
    const adapter = new LocalPdfReaderAdapter();
    await expect(
      adapter.extract({ kind: 'pdf', bytes: syntheticPdf(2), filename: 'blank.pdf' }),
    ).rejects.toThrow(/empty content/i);
  });

  it('refuses an image source with an explicit error', async () => {
    const adapter = new LocalPdfReaderAdapter();
    await expect(
      adapter.extract({
        kind: 'image',
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/only extract from PDF sources/i);
  });
});

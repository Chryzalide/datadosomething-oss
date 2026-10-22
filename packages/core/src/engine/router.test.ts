import { describe, expect, it, vi } from 'vitest';

vi.mock('./text-layer-probe', () => ({ probeTextLayer: vi.fn() }));

import { createDocument } from '../document-model';
import { type DocumentEngine, type EngineKind, NoEngineAvailableError } from './port';
import { EngineRouter } from './router';
import { probeTextLayer } from './text-layer-probe';

function mockEngine(kind: EngineKind, name: string): DocumentEngine {
  return {
    kind,
    name,
    extract: vi.fn(async () => createDocument({ type: 'pdf', pages: 1, provider: name }, [])),
  };
}

const source = { kind: 'pdf', bytes: new Uint8Array([1, 2, 3]) } as const;

describe('EngineRouter (AC2/AC3)', () => {
  it('routes a born-digital PDF to the reader', async () => {
    vi.mocked(probeTextLayer).mockResolvedValue('born-digital');
    const reader = mockEngine('reader', 'jina');
    const ocr = mockEngine('ocr', 'mistral');
    await new EngineRouter({ reader, ocr }).route(source);
    expect(reader.extract).toHaveBeenCalledOnce();
    expect(ocr.extract).not.toHaveBeenCalled();
  });

  it('routes a born-digital PDF to localReader when reader is unconfigured (1.3)', async () => {
    vi.mocked(probeTextLayer).mockResolvedValue('born-digital');
    const localReader = mockEngine('reader', 'local-pdf');
    const ocr = mockEngine('ocr', 'mistral');
    await new EngineRouter({ localReader, ocr }).route(source);
    expect(localReader.extract).toHaveBeenCalledOnce();
    expect(ocr.extract).not.toHaveBeenCalled();
  });

  it('falls back to OCR when the reader is unconfigured (AC3)', async () => {
    vi.mocked(probeTextLayer).mockResolvedValue('born-digital');
    const ocr = mockEngine('ocr', 'mistral');
    await new EngineRouter({ ocr }).route(source);
    expect(ocr.extract).toHaveBeenCalledOnce();
  });

  it('routes an image-only PDF to OCR', async () => {
    vi.mocked(probeTextLayer).mockResolvedValue('image-only');
    const reader = mockEngine('reader', 'jina');
    const ocr = mockEngine('ocr', 'mistral');
    await new EngineRouter({ reader, ocr }).route(source);
    expect(ocr.extract).toHaveBeenCalledOnce();
    expect(reader.extract).not.toHaveBeenCalled();
  });

  it('refuses (NoEngineAvailableError) when no engine can serve (AC3)', async () => {
    vi.mocked(probeTextLayer).mockResolvedValue('born-digital');
    await expect(new EngineRouter({}).route(source)).rejects.toBeInstanceOf(NoEngineAvailableError);
  });

  it('routes image-only to the reader when only a reader is configured (Jina reads scans)', async () => {
    vi.mocked(probeTextLayer).mockResolvedValue('image-only');
    const reader = mockEngine('reader', 'jina');
    await new EngineRouter({ reader }).route(source);
    expect(reader.extract).toHaveBeenCalledOnce();
  });

  it('falls back to OCR when the probe cannot read the PDF, if OCR is configured (AC3)', async () => {
    vi.mocked(probeTextLayer).mockRejectedValue(new Error('corrupt PDF'));
    const ocr = mockEngine('ocr', 'mistral');
    await new EngineRouter({ ocr }).route(source);
    expect(ocr.extract).toHaveBeenCalledOnce();
  });

  it('rethrows the probe error when the PDF is unreadable and no OCR is configured', async () => {
    vi.mocked(probeTextLayer).mockRejectedValue(new Error('corrupt PDF'));
    await expect(
      new EngineRouter({ reader: mockEngine('reader', 'jina') }).route(source),
    ).rejects.toThrow(/corrupt PDF/);
  });

  // ── Story 1.6: image source routes straight to OCR (no PDF probe) ──
  const imageSource = {
    kind: 'image',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
  } as const;

  it('routes an image source directly to OCR without probing (Story 1.6 AC1)', async () => {
    vi.mocked(probeTextLayer).mockClear();
    const ocr = mockEngine('ocr', 'mistral');
    const reader = mockEngine('reader', 'jina');
    await new EngineRouter({ reader, ocr }).route(imageSource);
    expect(ocr.extract).toHaveBeenCalledOnce();
    expect(reader.extract).not.toHaveBeenCalled();
    // Crucially, an image never touches the PDF text-layer probe.
    expect(probeTextLayer).not.toHaveBeenCalled();
  });

  it('refuses an image with NoEngineAvailableError when no OCR is configured (Story 1.6)', async () => {
    vi.mocked(probeTextLayer).mockClear();
    await expect(
      new EngineRouter({ reader: mockEngine('reader', 'jina') }).route(imageSource),
    ).rejects.toBeInstanceOf(NoEngineAvailableError);
    expect(probeTextLayer).not.toHaveBeenCalled();
  });
});

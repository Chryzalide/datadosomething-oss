import { describe, expect, it, vi } from 'vitest';

vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(),
}));

import { extractText } from 'unpdf';
import { probeTextLayer } from './text-layer-probe';

const bytes = new Uint8Array([1]);

describe('probeTextLayer — verdict thresholds (AC2)', () => {
  it('image-only when the text layer is empty', async () => {
    vi.mocked(extractText).mockResolvedValue({ totalPages: 1, text: '   \n  ' });
    expect(await probeTextLayer(bytes)).toBe('image-only');
  });

  it('ambiguous with only a little text (routes to OCR, AD-15 safety)', async () => {
    vi.mocked(extractText).mockResolvedValue({ totalPages: 1, text: 'a few words' });
    expect(await probeTextLayer(bytes)).toBe('ambiguous');
  });

  it('born-digital with a real text layer', async () => {
    vi.mocked(extractText).mockResolvedValue({ totalPages: 1, text: 'x'.repeat(150) });
    expect(await probeTextLayer(bytes)).toBe('born-digital');
  });

  it('merges per-page text arrays before classifying', async () => {
    // `unpdf` types `extractText(…, { mergePages: true })` as returning a single
    // `text: string`, so this shape is unrepresentable in its declared types.
    // The probe defends against it anyway (`Array.isArray(text) ? text.join('\n')`
    // in text-layer-probe.ts), because the library has been observed returning
    // the per-page form. The cast is what lets the test exercise that defence —
    // it is the defence that justifies the cast, not the other way round. Delete
    // both together or neither.
    vi.mocked(extractText).mockResolvedValue({
      totalPages: 2,
      text: ['x'.repeat(60), 'y'.repeat(60)],
    } as unknown as Awaited<ReturnType<typeof extractText>>);
    expect(await probeTextLayer(bytes)).toBe('born-digital');
  });
});

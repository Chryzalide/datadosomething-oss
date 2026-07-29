import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { probeTextLayer } from './text-layer-probe';

const fixture = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./__fixtures__/born-digital.pdf', import.meta.url))),
);

describe('probeTextLayer — real PDF (AC2)', () => {
  it('classifies a real born-digital PDF as born-digital', async () => {
    expect(await probeTextLayer(fixture)).toBe('born-digital');
  });

  it('throws an explicit error on unreadable bytes (never a silent image-only)', async () => {
    await expect(probeTextLayer(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/text layer/i);
  });
});

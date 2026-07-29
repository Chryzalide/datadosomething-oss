import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createDocument } from './document-model';
import type { DocumentEngine } from './engine/port';
import { convertToMarkdown } from './pipeline';

// The REAL probe (unpdf) on a REAL fixture — no mocks — so this exercises the
// shipped router path end to end. It is the regression guard for the buffer
// detach bug (the probe must not detach the caller's bytes before extract).
const fixture = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./engine/__fixtures__/born-digital.pdf', import.meta.url))),
);

describe('pipeline + router with the real probe (composed path)', () => {
  it('probes then hands INTACT (non-detached) bytes to the engine', async () => {
    let receivedBytes = -1;
    const reader: DocumentEngine = {
      kind: 'reader',
      name: 'mock-reader',
      extract: vi.fn(async (source) => {
        receivedBytes = source.bytes.byteLength;
        return createDocument({ type: 'pdf', pages: 1, provider: 'mock' }, [
          { type: 'paragraph', text: 'ok', page: 1 },
        ]);
      }),
    };

    const md = await convertToMarkdown({ kind: 'pdf', bytes: fixture }, { reader });

    expect(reader.extract).toHaveBeenCalledOnce();
    // Would be 0 if the probe had detached the buffer.
    expect(receivedBytes).toBe(fixture.byteLength);
    expect(md).toBe('ok');
  });
});

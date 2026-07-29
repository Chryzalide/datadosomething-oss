import { describe, expect, it } from 'vitest';
import { type Block, createDocument, DOCUMENT_MODEL_VERSION } from './document-model';

describe('Document Model (AC1)', () => {
  it('createDocument stamps the current schema version', () => {
    const d = createDocument({ type: 'pdf', pages: 2, provider: 'test' }, []);
    expect(d.version).toBe('1.0');
    expect(DOCUMENT_MODEL_VERSION).toBe('1.0');
    expect(d.source).toEqual({ type: 'pdf', pages: 2, provider: 'test' });
    expect(d.blocks).toEqual([]);
  });

  it('blocks carry a page plus optional best-effort fields', () => {
    const block: Block = {
      type: 'paragraph',
      text: 'x',
      page: 3,
      confidence: 0.9,
      bbox: { x: 0, y: 0, width: 10, height: 4 },
    };
    expect(block.page).toBe(3);
    expect(block.confidence).toBe(0.9);
    expect(block.bbox?.width).toBe(10);
  });
});

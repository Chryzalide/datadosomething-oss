import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../renderers/markdown';
import { markdownToDocument } from './markdown-to-document';

const src = { type: 'pdf', pages: 1, provider: 'test' } as const;

describe('markdownToDocument (AC1/AC2)', () => {
  it('maps the closed block set (heading/paragraph/list/table)', () => {
    const doc = markdownToDocument(
      '# Title\n\nIntro text.\n\n- a\n- b\n\n1. one\n2. two\n\n| H1 | H2 |\n| --- | --- |\n| x | y |',
      src,
    );
    expect(doc.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title', page: 1 },
      { type: 'paragraph', text: 'Intro text.', page: 1 },
      { type: 'list', ordered: false, items: ['a', 'b'], page: 1 },
      { type: 'list', ordered: true, items: ['one', 'two'], page: 1 },
      {
        type: 'table',
        rows: [
          ['H1', 'H2'],
          ['x', 'y'],
        ],
        page: 1,
      },
    ]);
    expect(doc.version).toBe('1.0');
    expect(doc.source).toEqual(src);
  });

  it('flattens inline emphasis/links to plain text (structural model, AD-4)', () => {
    const doc = markdownToDocument('This is **bold** and [a link](http://x).', src);
    expect(doc.blocks).toEqual([{ type: 'paragraph', text: 'This is bold and a link.', page: 1 }]);
  });

  it('strips inline HTML markup (structural plain text)', () => {
    const doc = markdownToDocument('a <span style="x">b</span> c', src);
    expect(doc.blocks).toEqual([{ type: 'paragraph', text: 'a b c', page: 1 }]);
  });

  it('preserves code blocks with language and newlines, blockquotes as paragraphs; drops structural-only tokens', () => {
    const doc = markdownToDocument(
      '```ts\nconst x = 1;\nconst y = 2;\n```\n\n> quoted\n\n---\n\nreal.',
      src,
    );
    expect(doc.blocks).toEqual([
      { type: 'code', language: 'ts', text: 'const x = 1;\nconst y = 2;', page: 1 },
      { type: 'paragraph', text: 'quoted', page: 1 },
      { type: 'paragraph', text: 'real.', page: 1 },
    ]);
  });

  it('preserves nested sub-list items with indented markers (no content or hierarchy dropped)', () => {
    const doc = markdownToDocument('- a\n  - a1\n  - a2\n- b', src);
    expect(doc.blocks).toEqual([
      { type: 'list', ordered: false, items: ['a\n  - a1\n  - a2', 'b'], page: 1 },
    ]);
    expect(renderMarkdown(doc)).toBe('- a\n  - a1\n  - a2\n- b');
  });

  it('space-joins a loose multi-paragraph list item (no run-together text)', () => {
    const doc = markdownToDocument('- para one\n\n  para two\n- b', src);
    expect(doc.blocks).toEqual([
      { type: 'list', ordered: false, items: ['para one para two', 'b'], page: 1 },
    ]);
  });

  it('round-trips through renderMarkdown — the model is the pivot', () => {
    const doc = markdownToDocument('# H\n\n- a\n- b', src);
    expect(renderMarkdown(doc)).toBe('# H\n\n- a\n- b');
  });
});

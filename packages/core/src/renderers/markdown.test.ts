import { describe, expect, it } from 'vitest';
import { createDocument, type Block, type DocumentModel } from '../document-model';
import { renderMarkdown } from './markdown';

const doc = (blocks: Block[]): DocumentModel =>
  createDocument({ type: 'pdf', pages: 1, provider: 'test' }, blocks);

describe('renderMarkdown — headings (AC2/AC3)', () => {
  it('renders levels 1..6 as the matching number of #', () => {
    expect(renderMarkdown(doc([{ type: 'heading', level: 1, text: 'One', page: 1 }]))).toBe(
      '# One',
    );
    expect(renderMarkdown(doc([{ type: 'heading', level: 2, text: 'Two', page: 1 }]))).toBe(
      '## Two',
    );
    expect(renderMarkdown(doc([{ type: 'heading', level: 6, text: 'Six', page: 1 }]))).toBe(
      '###### Six',
    );
  });

  it('clamps out-of-range levels into 1..6 (adds no structure)', () => {
    expect(renderMarkdown(doc([{ type: 'heading', level: 9, text: 'Deep', page: 1 }]))).toBe(
      '###### Deep',
    );
    expect(renderMarkdown(doc([{ type: 'heading', level: 0, text: 'Top', page: 1 }]))).toBe(
      '# Top',
    );
  });
});

describe('renderMarkdown — paragraphs & lists (AC2)', () => {
  it('renders a paragraph verbatim', () => {
    expect(renderMarkdown(doc([{ type: 'paragraph', text: 'Hello world.', page: 1 }]))).toBe(
      'Hello world.',
    );
  });

  it('renders an unordered list', () => {
    expect(
      renderMarkdown(doc([{ type: 'list', ordered: false, items: ['a', 'b', 'c'], page: 1 }])),
    ).toBe('- a\n- b\n- c');
  });

  it('renders an ordered list with sequential numbers', () => {
    expect(
      renderMarkdown(doc([{ type: 'list', ordered: true, items: ['a', 'b', 'c'], page: 1 }])),
    ).toBe('1. a\n2. b\n3. c');
  });

  it('drops an empty list (no stray structure)', () => {
    expect(renderMarkdown(doc([{ type: 'list', ordered: true, items: [], page: 1 }]))).toBe('');
  });
});

describe('renderMarkdown — tables (AC2)', () => {
  it('renders a multi-row table: header, separator, body', () => {
    const md = renderMarkdown(
      doc([
        {
          type: 'table',
          rows: [
            ['Name', 'Qty'],
            ['Widget', '3'],
            ['Gadget', '12'],
          ],
          page: 1,
        },
      ]),
    );
    expect(md).toBe('| Name | Qty |\n| --- | --- |\n| Widget | 3 |\n| Gadget | 12 |');
  });

  it('escapes pipe characters in cells', () => {
    const md = renderMarkdown(
      doc([
        {
          type: 'table',
          rows: [
            ['a|b', 'c'],
            ['d', 'e|f'],
          ],
          page: 1,
        },
      ]),
    );
    expect(md).toBe('| a\\|b | c |\n| --- | --- |\n| d | e\\|f |');
  });

  it('normalizes ragged rows to the header column count', () => {
    const md = renderMarkdown(doc([{ type: 'table', rows: [['A', 'B'], ['only-one']], page: 1 }]));
    expect(md).toBe('| A | B |\n| --- | --- |\n| only-one |  |');
  });

  it('drops a zero-row table', () => {
    expect(renderMarkdown(doc([{ type: 'table', rows: [], page: 1 }]))).toBe('');
  });
});

describe('renderMarkdown — assembly & determinism (AC2/AC3)', () => {
  const fixture: Block[] = [
    { type: 'heading', level: 1, text: 'Report', page: 1 },
    { type: 'paragraph', text: 'Intro paragraph.', page: 1 },
    { type: 'heading', level: 2, text: 'Items', page: 2 },
    { type: 'list', ordered: false, items: ['first', 'second'], page: 2 },
    {
      type: 'table',
      rows: [
        ['K', 'V'],
        ['x', '1'],
      ],
      page: 2,
    },
  ];

  it('preserves block order and separates blocks with a blank line', () => {
    expect(renderMarkdown(doc(fixture))).toBe(
      [
        '# Report',
        '',
        'Intro paragraph.',
        '',
        '## Items',
        '',
        '- first\n- second',
        '',
        '| K | V |\n| --- | --- |\n| x | 1 |',
      ].join('\n'),
    );
  });

  it('is byte-identical across repeated renders (pure function)', () => {
    const model = doc(fixture);
    expect(renderMarkdown(model)).toBe(renderMarkdown(model));
  });

  it('renders two structurally-equal models identically', () => {
    expect(renderMarkdown(doc(fixture))).toBe(renderMarkdown(doc(structuredClone(fixture))));
  });

  it('renders an empty document as an empty string', () => {
    expect(renderMarkdown(doc([]))).toBe('');
  });
});

describe('renderMarkdown — faithful escaping: adds no structure (AC2)', () => {
  it('escapes leading block markers in a paragraph (no heading/list/quote injection)', () => {
    expect(renderMarkdown(doc([{ type: 'paragraph', text: '# Title', page: 1 }]))).toBe(
      '\\# Title',
    );
    expect(renderMarkdown(doc([{ type: 'paragraph', text: '- item', page: 1 }]))).toBe('\\- item');
    expect(renderMarkdown(doc([{ type: 'paragraph', text: '> quote', page: 1 }]))).toBe(
      '\\> quote',
    );
    expect(renderMarkdown(doc([{ type: 'paragraph', text: '1. one', page: 1 }]))).toBe('1\\. one');
  });

  it('escapes code fences so they cannot swallow following blocks', () => {
    const md = renderMarkdown(
      doc([
        { type: 'paragraph', text: '```', page: 1 },
        { type: 'paragraph', text: 'after', page: 1 },
      ]),
    );
    expect(md).toBe('\\`\\`\\`\n\nafter');
  });

  it('escapes inline emphasis and links (literal text, no formatting added)', () => {
    expect(renderMarkdown(doc([{ type: 'paragraph', text: '*bold* _em_', page: 1 }]))).toBe(
      '\\*bold\\* \\_em\\_',
    );
    expect(renderMarkdown(doc([{ type: 'paragraph', text: '[a](b)', page: 1 }]))).toBe(
      '\\[a\\](b)',
    );
  });

  it('collapses newlines in text and list items (no phantom blocks / broken lists)', () => {
    expect(renderMarkdown(doc([{ type: 'paragraph', text: 'a\n\nb', page: 1 }]))).toBe('a  b');
    expect(
      renderMarkdown(doc([{ type: 'list', ordered: false, items: ['line1\nline2'], page: 1 }])),
    ).toBe('- line1 line2');
  });

  it('clamps a NaN heading level to 1', () => {
    expect(renderMarkdown(doc([{ type: 'heading', level: Number.NaN, text: 'X', page: 1 }]))).toBe(
      '# X',
    );
  });
});

describe('renderMarkdown — tables never lose data (AC2)', () => {
  it('escapes a pre-existing backslash before the pipe (no column split)', () => {
    expect(renderMarkdown(doc([{ type: 'table', rows: [['a\\|b', 'c']], page: 1 }]))).toBe(
      '| a\\\\\\|b | c |\n| --- | --- |',
    );
  });

  it('keeps every cell when a row is wider than the header (no truncation)', () => {
    expect(renderMarkdown(doc([{ type: 'table', rows: [['A'], ['x', 'y', 'z']], page: 1 }]))).toBe(
      '| A |  |  |\n| --- | --- | --- |\n| x | y | z |',
    );
  });

  it('handles an empty header row without discarding body data', () => {
    expect(renderMarkdown(doc([{ type: 'table', rows: [[], ['x', 'y']], page: 1 }]))).toBe(
      '|  |  |\n| --- | --- |\n| x | y |',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { createDocument, type Block, type DocumentModel } from '../document-model';
import { PDFTOJSON_SCHEMA_VERSION, projectToJson, renderJson, type JsonDocument } from './json';
import { PDFTOJSON_JSON_SCHEMA } from './pdftojson-schema';

const doc = (blocks: Block[]): DocumentModel =>
  createDocument({ type: 'pdf', pages: 1, provider: 'test' }, blocks);

const parse = (doc: DocumentModel): JsonDocument => JSON.parse(renderJson(doc)) as JsonDocument;

describe('renderJson — versioned contract (AC1)', () => {
  it('carries schema_version "1.0"', () => {
    expect(projectToJson(doc([])).schema_version).toBe('1.0');
    expect(PDFTOJSON_SCHEMA_VERSION).toBe('1.0');
  });

  it('emits the document-level source object (type/pages/provider)', () => {
    const out = projectToJson(
      createDocument({ type: 'image', pages: 3, provider: 'engine-x' }, []),
    );
    expect(out.source).toEqual({ type: 'image', pages: 3, provider: 'engine-x' });
  });

  it('emits all four block types, each with type + page', () => {
    const out = parse(
      doc([
        { type: 'heading', level: 2, text: 'Title', page: 1 },
        { type: 'paragraph', text: 'Body.', page: 1 },
        { type: 'list', ordered: true, items: ['a', 'b'], page: 2 },
        {
          type: 'table',
          rows: [
            ['h1', 'h2'],
            ['a', 'b'],
          ],
          page: 3,
        },
      ]),
    );
    expect(out.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'table']);
    for (const b of out.blocks) {
      expect(typeof b.type).toBe('string');
      expect(typeof b.page).toBe('number');
    }
    expect(out.blocks[0]).toMatchObject({ type: 'heading', level: 2, text: 'Title', page: 1 });
    expect(out.blocks[2]).toMatchObject({
      type: 'list',
      ordered: true,
      items: ['a', 'b'],
      page: 2,
    });
    expect(out.blocks[3]).toMatchObject({
      type: 'table',
      rows: [
        ['h1', 'h2'],
        ['a', 'b'],
      ],
      page: 3,
    });
  });
});

describe('renderJson — optional best-effort fields (AC1)', () => {
  it('includes bbox + confidence when present', () => {
    const out = projectToJson(
      doc([
        {
          type: 'paragraph',
          text: 'x',
          page: 1,
          bbox: { x: 1, y: 2, width: 3, height: 4 },
          confidence: 0.9,
        },
      ]),
    );
    expect(out.blocks[0]).toMatchObject({
      bbox: { x: 1, y: 2, width: 3, height: 4 },
      confidence: 0.9,
    });
  });

  it('omits bbox/confidence entirely when absent (key absent, not null)', () => {
    const json = renderJson(doc([{ type: 'paragraph', text: 'x', page: 1 }]));
    expect(json).not.toContain('bbox');
    expect(json).not.toContain('confidence');
    expect(json).not.toContain('null');
    const block = parse(doc([{ type: 'paragraph', text: 'x', page: 1 }])).blocks[0];
    expect(block && 'bbox' in block).toBe(false);
    expect(block && 'confidence' in block).toBe(false);
  });

  it('omits non-finite optional numbers (stays valid JSON — no null)', () => {
    const out = projectToJson(
      doc([
        {
          type: 'paragraph',
          text: 'x',
          page: 1,
          confidence: Number.NaN,
          bbox: { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 },
        },
      ]),
    );
    expect(out.blocks[0] && 'confidence' in out.blocks[0]).toBe(false);
    expect(out.blocks[0] && 'bbox' in out.blocks[0]).toBe(false);
    expect(
      renderJson(doc([{ type: 'paragraph', text: 'x', page: 1, confidence: Number.NaN }])),
    ).not.toContain('null');
  });

  it('coerces non-finite required numbers (page, level) to a finite fallback', () => {
    const out = projectToJson(
      doc([{ type: 'heading', level: Number.NaN, text: 'x', page: Number.NaN }]),
    );
    const block = out.blocks[0];
    expect(block?.type).toBe('heading');
    expect(block && block.type === 'heading' && block.level).toBe(1);
    expect(block?.page).toBe(1);
    // JSON never emits the invalid `null` for these required numerics.
    expect(
      renderJson(doc([{ type: 'heading', level: Number.NaN, text: 'x', page: Number.NaN }])),
    ).not.toContain('null');
  });
});

describe('renderJson — range bounds keep output schema-valid (AC1/AC3)', () => {
  it('clamps heading level into 1..6 (schema range + parity with renderMarkdown)', () => {
    const deep = projectToJson(doc([{ type: 'heading', level: 9, text: 'x', page: 1 }])).blocks[0];
    expect(deep && deep.type === 'heading' && deep.level).toBe(6);
    const shallow = projectToJson(doc([{ type: 'heading', level: 0, text: 'x', page: 1 }]))
      .blocks[0];
    expect(shallow && shallow.type === 'heading' && shallow.level).toBe(1);
  });

  it('clamps page to the schema minimum of 1 (0-based / negative adapters)', () => {
    expect(projectToJson(doc([{ type: 'paragraph', text: 'x', page: 0 }])).blocks[0]?.page).toBe(1);
    expect(projectToJson(doc([{ type: 'paragraph', text: 'x', page: -5 }])).blocks[0]?.page).toBe(
      1,
    );
  });

  it('clamps source.pages to the schema minimum of 0', () => {
    expect(
      projectToJson(createDocument({ type: 'pdf', pages: -1, provider: 't' }, [])).source.pages,
    ).toBe(0);
  });

  it('drops out-of-range confidence (best-effort — never fabricates certainty)', () => {
    const over = projectToJson(doc([{ type: 'paragraph', text: 'x', page: 1, confidence: 1.5 }]))
      .blocks[0];
    expect(over && 'confidence' in over).toBe(false);
    const under = projectToJson(doc([{ type: 'paragraph', text: 'x', page: 1, confidence: -0.2 }]))
      .blocks[0];
    expect(under && 'confidence' in under).toBe(false);
    // A percentage-style 95 (a provider bug) is dropped, not emitted as 95.
    expect(
      renderJson(doc([{ type: 'paragraph', text: 'x', page: 1, confidence: 95 }])),
    ).not.toContain('95');
  });

  it('keeps confidence === 0 (a valid boundary, not falsy-dropped)', () => {
    const out = projectToJson(doc([{ type: 'paragraph', text: 'x', page: 1, confidence: 0 }]))
      .blocks[0];
    expect(out?.confidence).toBe(0);
  });
});

describe('renderJson — projection is isolated from the input model (AC2)', () => {
  it('returns no live array reference into the source model (deep copy)', () => {
    const model = doc([
      { type: 'list', ordered: false, items: ['a'], page: 1 },
      { type: 'table', rows: [['c']], page: 1 },
    ]);
    const out = projectToJson(model);
    const list = out.blocks[0];
    const table = out.blocks[1];
    if (list?.type === 'list') list.items.push('mutated');
    if (table?.type === 'table') table.rows[0]?.push('mutated');
    // Mutating the projection must not reach back into the original model.
    const srcList = model.blocks[0];
    const srcTable = model.blocks[1];
    expect(srcList?.type === 'list' && srcList.items).toEqual(['a']);
    expect(srcTable?.type === 'table' && srcTable.rows).toEqual([['c']]);
  });
});

describe('renderJson — pure projection / pdftomd parity (AC2)', () => {
  const fixture = doc([
    { type: 'heading', level: 1, text: 'H', page: 1 },
    { type: 'paragraph', text: 'P', page: 1 },
    { type: 'list', ordered: false, items: ['i'], page: 2 },
    { type: 'table', rows: [['c']], page: 2 },
  ]);

  it('preserves block count, type sequence, and order exactly (adds no structure)', () => {
    const out = projectToJson(fixture);
    expect(out.blocks).toHaveLength(fixture.blocks.length);
    expect(out.blocks.map((b) => b.type)).toEqual(fixture.blocks.map((b) => b.type));
  });

  it('carries in-block text VERBATIM — never Markdown-escaped (inverse of renderMarkdown)', () => {
    const raw = '# Title | - item | 1. x | `code` | [a](b)';
    const out = parse(doc([{ type: 'paragraph', text: raw, page: 1 }]));
    const block = out.blocks[0];
    // The parsed value is exactly the original string — no backslashes injected.
    expect(block && block.type === 'paragraph' && block.text).toBe(raw);
  });
});

describe('renderJson — validity, determinism, schema (AC3)', () => {
  const fixture = doc([
    { type: 'heading', level: 3, text: 'Deep', page: 1 },
    { type: 'list', ordered: true, items: ['a', 'b'], page: 1 },
    { type: 'table', rows: [['h'], ['v']], page: 2 },
  ]);

  it('is syntactically valid JSON (JSON.parse round-trips)', () => {
    expect(() => JSON.parse(renderJson(fixture))).not.toThrow();
    expect(parse(fixture)).toEqual(projectToJson(fixture));
  });

  it('is byte-identical across repeated renders (determinism)', () => {
    expect(renderJson(fixture)).toBe(renderJson(fixture));
  });

  it('renders a structurally-cloned model identically (no key-order nondeterminism)', () => {
    const clone: DocumentModel = structuredClone(fixture);
    expect(renderJson(clone)).toBe(renderJson(fixture));
  });

  it('handles an empty document (blocks: [])', () => {
    expect(projectToJson(doc([])).blocks).toEqual([]);
    expect(() => JSON.parse(renderJson(doc([])))).not.toThrow();
  });

  it('publishes a Draft 2020-12 schema whose const version matches the output', () => {
    expect(PDFTOJSON_JSON_SCHEMA.$schema).toContain('2020-12');
    expect(PDFTOJSON_JSON_SCHEMA.properties.schema_version.const).toBe(PDFTOJSON_SCHEMA_VERSION);
    expect(PDFTOJSON_JSON_SCHEMA.required).toEqual(['schema_version', 'source', 'blocks']);
    // bbox/confidence are optional in every block $def (never in `required`).
    for (const def of [
      PDFTOJSON_JSON_SCHEMA.$defs.heading,
      PDFTOJSON_JSON_SCHEMA.$defs.paragraph,
      PDFTOJSON_JSON_SCHEMA.$defs.list,
      PDFTOJSON_JSON_SCHEMA.$defs.table,
    ]) {
      expect(def.required).not.toContain('bbox');
      expect(def.required).not.toContain('confidence');
    }
  });

  it('output satisfies the schema — including numeric ranges — even for out-of-range model input', () => {
    // A worst-case model: every numeric field out of the schema's declared range.
    const worst = createDocument({ type: 'pdf', pages: -3, provider: 't' }, [
      { type: 'heading', level: 42, text: 'x', page: 0, confidence: 5 },
      { type: 'paragraph', text: 'y', page: -1, bbox: { x: 1, y: 2, width: 3, height: 4 } },
    ]);
    const out = parse(worst);
    for (const key of PDFTOJSON_JSON_SCHEMA.required) expect(out).toHaveProperty(key);
    expect(out.schema_version).toBe('1.0');
    // source.pages ≥ 0 (schema minimum).
    expect(out.source.pages).toBeGreaterThanOrEqual(0);
    for (const b of out.blocks) {
      expect(['heading', 'paragraph', 'list', 'table']).toContain(b.type);
      // page ≥ 1 (schema minimum), integer.
      expect(Number.isInteger(b.page)).toBe(true);
      expect(b.page).toBeGreaterThanOrEqual(1);
      // level in 1..6 (schema range) when present.
      if (b.type === 'heading') {
        expect(b.level).toBeGreaterThanOrEqual(1);
        expect(b.level).toBeLessThanOrEqual(6);
      }
      // confidence, when present, in 0..1 (schema range).
      if (b.confidence !== undefined) {
        expect(b.confidence).toBeGreaterThanOrEqual(0);
        expect(b.confidence).toBeLessThanOrEqual(1);
      }
    }
    // No numeric field ever serialized as the invalid `null`.
    expect(renderJson(worst)).not.toContain('null');
  });
});

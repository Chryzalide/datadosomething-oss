import { describe, expect, it } from 'vitest';
import { createDocument, type Block, type DocumentModel } from '../document-model';
import {
  NETTOYAGE_WHITESPACE,
  OCR_ARTIFACT_CHARS,
  ruleCleanDocument,
  ruleCleanText,
} from './rule-pass';

/** Build a character from a code point — keeps this source pure ASCII. */
const ch = (codePoint: number): string => String.fromCodePoint(codePoint);

const SPACE = ch(0x20);
const TAB = ch(0x09);
const LF = ch(0x0a);
const CR = ch(0x0d);
const NBSP = ch(0xa0);
const ZWSP = ch(0x200b);
const SOFT_HYPHEN = ch(0xad);
const BOM = ch(0xfeff);
const REPLACEMENT = ch(0xfffd);

/** Every code point the rule pass is allowed to touch (artifact + whitespace). */
const ARTIFACT_SAMPLES = [
  0x0000, 0x0001, 0x0008, 0x000e, 0x001f, 0x007f, 0x0085, 0x009f, 0x00ad, 0x200b, 0x200d, 0x200f,
  0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0xfeff, 0xfffd,
];
const WHITESPACE_SAMPLES = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029,
  0x202f, 0x205f, 0x3000,
];

/**
 * `strip` deletes every character the rule pass may touch. What remains is the
 * semantic content — the thing stage 1 must never alter.
 */
const strip = (value: string): string =>
  [...value].filter((c) => !OCR_ARTIFACT_CHARS.test(c) && !NETTOYAGE_WHITESPACE.test(c)).join('');

const doc = (blocks: Block[]): DocumentModel =>
  createDocument({ type: 'pdf', pages: 2, provider: 'test' }, blocks);

/**
 * An INDEPENDENT oracle for the two classes, written out again here on purpose.
 * The module builds its regexes from range tables; this restates the intended
 * membership so a typo in either place fails the exhaustive scan below rather
 * than agreeing with itself.
 */
const inAny = (codePoint: number, ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([low, high]) => codePoint >= low && codePoint <= high);

const EXPECTED_ARTIFACTS = [
  [0x0000, 0x0008],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
] as const;

const EXPECTED_WHITESPACE = [
  [0x0009, 0x000d],
  [0x0020, 0x0020],
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
] as const;

describe('character classes (AC2 contract)', () => {
  it('match exactly the intended code points across the whole BMP', () => {
    // Exhaustive rather than sampled: these two classes are the contract Story
    // 3.2's verifier inherits, and they are assembled from raw characters, so a
    // stray range boundary or a member that is regex-class syntax (- ] ^ \)
    // would silently corrupt the class. Surrogates (D800-DFFF) are skipped —
    // they are not standalone characters.
    const artifactMisses: number[] = [];
    const whitespaceMisses: number[] = [];
    for (let cp = 0; cp <= 0xffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = ch(cp);
      if (OCR_ARTIFACT_CHARS.test(c) !== inAny(cp, EXPECTED_ARTIFACTS)) artifactMisses.push(cp);
      if (NETTOYAGE_WHITESPACE.test(c) !== inAny(cp, EXPECTED_WHITESPACE))
        whitespaceMisses.push(cp);
    }
    expect(artifactMisses).toEqual([]);
    expect(whitespaceMisses).toEqual([]);
  });

  it('never swallow regex character-class syntax (- ] ^ backslash)', () => {
    // The classes are built by concatenating literal characters, so a member
    // that is class syntax would change what the class means.
    for (const c of ['-', ']', '^', '\\']) {
      expect(OCR_ARTIFACT_CHARS.test(c)).toBe(false);
      expect(NETTOYAGE_WHITESPACE.test(c)).toBe(false);
      expect(ruleCleanText(`a${c}b`)).toBe(`a${c}b`);
    }
  });

  it('are disjoint — no code point is both an artifact and whitespace', () => {
    for (let cp = 0; cp <= 0xffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = ch(cp);
      expect(OCR_ARTIFACT_CHARS.test(c) && NETTOYAGE_WHITESPACE.test(c)).toBe(false);
    }
    for (const codePoint of ARTIFACT_SAMPLES) {
      expect(NETTOYAGE_WHITESPACE.test(ch(codePoint))).toBe(false);
    }
    for (const codePoint of WHITESPACE_SAMPLES) {
      expect(OCR_ARTIFACT_CHARS.test(ch(codePoint))).toBe(false);
    }
  });

  it('are exported non-global, so repeated .test() is stateless', () => {
    expect(OCR_ARTIFACT_CHARS.global).toBe(false);
    expect(NETTOYAGE_WHITESPACE.global).toBe(false);
    // A global regex would alternate true/false here via lastIndex.
    for (let i = 0; i < 3; i += 1) expect(OCR_ARTIFACT_CHARS.test(ZWSP)).toBe(true);
    for (let i = 0; i < 3; i += 1) expect(NETTOYAGE_WHITESPACE.test(NBSP)).toBe(true);
  });

  it('do not match ordinary visible text', () => {
    for (const c of 'Chapitre 3 — coût: 12,50 € (déjà payé) [a\\b]|~`#*_{}') {
      expect(OCR_ARTIFACT_CHARS.test(c)).toBe(false);
    }
  });
});

describe('ruleCleanText — removes artifacts (AC2)', () => {
  it('deletes every artifact code point outright', () => {
    for (const codePoint of ARTIFACT_SAMPLES) {
      expect(ruleCleanText(`a${ch(codePoint)}b`)).toBe('ab');
    }
  });

  it('deletes the artifacts a real OCR pass produces', () => {
    expect(ruleCleanText(`co${SOFT_HYPHEN}operate`)).toBe('cooperate');
    expect(ruleCleanText(`${BOM}Title`)).toBe('Title');
    expect(ruleCleanText(`Total: 42${REPLACEMENT}`)).toBe('Total: 42');
  });
});

describe('ruleCleanText — normalizes whitespace (AC2)', () => {
  it('normalizes every whitespace code point to a single space', () => {
    for (const codePoint of WHITESPACE_SAMPLES) {
      expect(ruleCleanText(`a${ch(codePoint)}b`)).toBe('a b');
    }
  });

  it('collapses runs and trims the ends', () => {
    expect(ruleCleanText(`${SPACE}${SPACE}a${TAB}${TAB}b${LF}${LF}c${SPACE}`)).toBe('a b c');
    expect(ruleCleanText(`${CR}${LF}line${CR}${LF}`)).toBe('line');
    expect(ruleCleanText(`${NBSP}${NBSP}x${NBSP}`)).toBe('x');
  });

  it('deletes artifacts BEFORE collapsing, so an invisible char cannot hold a gap open', () => {
    // Without the ordering, the ZWSP would split the run and leave "a  b".
    expect(ruleCleanText(`a${SPACE}${ZWSP}${SPACE}b`)).toBe('a b');
  });

  it('returns the empty string for input that is only artifacts and whitespace', () => {
    expect(ruleCleanText(`${SPACE}${ZWSP}${NBSP}${BOM}${TAB}`)).toBe('');
    expect(ruleCleanText('')).toBe('');
  });
});

describe('ruleCleanText — changes nothing semantic (AC2, the invariant)', () => {
  const corpus = [
    '',
    'plain text',
    `${SPACE}${SPACE}leading and trailing${SPACE}${SPACE}`,
    `mixed${TAB}${ZWSP}${NBSP}noise${LF}here`,
    `${BOM}Chapitre 3 ${REPLACEMENT} coût: 12,50 ${ch(0x20ac)}`,
    `co${SOFT_HYPHEN}operate inter-${LF}national`,
    `1. item${SPACE}${SPACE}| cell |`,
    `${ch(0x1f600)} emoji ${ch(0x1f600)}`,
    `caf${ch(0x65)}${ch(0x301)} combining`,
    `${ZWSP}${ZWSP}${ZWSP}`,
    'a\\b|c~d`e#f*g_h{i}j[k]l<m>n',
  ];

  it('preserves every visible character, in order, for the whole corpus', () => {
    for (const input of corpus) {
      expect(strip(ruleCleanText(input))).toBe(strip(input));
    }
  });

  it('never folds visible glyphs (no de-hyphenation, no quote/dash/ligature rewriting)', () => {
    expect(ruleCleanText(`inter-${LF}national`)).toBe('inter- national');
    const glyphs = `${ch(0x201c)}quoted${ch(0x201d)} ${ch(0x2014)} ${ch(0xfb01)}n`;
    expect(ruleCleanText(glyphs)).toBe(glyphs);
  });
});

describe('ruleCleanText — pure and deterministic (AC2)', () => {
  const input = `${SPACE}a${ZWSP}${TAB}b${NBSP}`;

  it('is deterministic across calls', () => {
    expect(ruleCleanText(input)).toBe(ruleCleanText(input));
  });

  it('is idempotent', () => {
    const once = ruleCleanText(input);
    expect(ruleCleanText(once)).toBe(once);
  });
});

describe('ruleCleanDocument — structure is immutable (AC2, AD-8)', () => {
  const source: Block[] = [
    { type: 'heading', level: 2, text: `${BOM}Title${SPACE}${SPACE}`, page: 1, confidence: 0.9 },
    {
      type: 'paragraph',
      text: `Body${ZWSP}${TAB}text.`,
      page: 1,
      bbox: { x: 1, y: 2, width: 3, height: 4 },
    },
    { type: 'list', ordered: true, items: [`${NBSP}one`, `two${ZWSP}`], page: 2 },
    {
      type: 'table',
      rows: [
        [`h1${SPACE}${SPACE}`, `${BOM}h2`],
        [`a${NBSP}1`, ''],
      ],
      page: 2,
    },
  ];

  it('cleans in-block text of every block type', () => {
    const out = ruleCleanDocument(doc(source));
    expect(out.blocks[0]).toMatchObject({ type: 'heading', level: 2, text: 'Title' });
    expect(out.blocks[1]).toMatchObject({ type: 'paragraph', text: 'Body text.' });
    expect(out.blocks[2]).toMatchObject({ type: 'list', ordered: true, items: ['one', 'two'] });
    expect(out.blocks[3]).toMatchObject({
      type: 'table',
      rows: [
        ['h1', 'h2'],
        ['a 1', ''],
      ],
    });
  });

  it('preserves block count, types, order, page, bbox and confidence', () => {
    const input = doc(source);
    const out = ruleCleanDocument(input);
    expect(out.blocks).toHaveLength(input.blocks.length);
    expect(out.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'table']);
    expect(out.blocks.map((b) => b.page)).toEqual([1, 1, 2, 2]);
    expect(out.blocks[0]?.confidence).toBe(0.9);
    expect(out.blocks[1]?.bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(out.version).toBe(input.version);
    expect(out.source).toEqual(input.source);
  });

  it('keeps a block whose text cleans to empty — dropping it would be structural', () => {
    const out = ruleCleanDocument(
      doc([
        { type: 'paragraph', text: `${ZWSP}${SPACE}${BOM}`, page: 1 },
        { type: 'list', ordered: false, items: [`${NBSP}`, 'kept'], page: 1 },
      ]),
    );
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0]).toMatchObject({ type: 'paragraph', text: '' });
    expect(out.blocks[1]).toMatchObject({ type: 'list', items: ['', 'kept'] });
  });

  it('does not mutate the input model', () => {
    const input = doc(structuredClone(source));
    const before = structuredClone(input);
    ruleCleanDocument(input);
    expect(input).toEqual(before);
  });

  it('returns a model sharing no mutable object with the input', () => {
    const input = doc(structuredClone(source));
    const out = ruleCleanDocument(input);
    expect(out).not.toBe(input);
    expect(out.source).not.toBe(input.source);
    expect(out.blocks[1]?.bbox).not.toBe(input.blocks[1]?.bbox);
    const outList = out.blocks[2];
    const inList = input.blocks[2];
    if (outList?.type === 'list' && inList?.type === 'list') {
      expect(outList.items).not.toBe(inList.items);
    }
    const outTable = out.blocks[3];
    const inTable = input.blocks[3];
    if (outTable?.type === 'table' && inTable?.type === 'table') {
      expect(outTable.rows).not.toBe(inTable.rows);
      expect(outTable.rows[0]).not.toBe(inTable.rows[0]);
    }
  });

  it('preserves the semantic content of the whole document (the invariant, model-wide)', () => {
    const input = doc(source);
    const out = ruleCleanDocument(input);
    const textOf = (model: DocumentModel): string =>
      model.blocks
        .map((b) => {
          switch (b.type) {
            case 'heading':
            case 'paragraph':
            case 'code':
              return b.text;
            case 'list':
              return b.items.join('');
            case 'table':
              return b.rows.flat().join('');
          }
        })
        .join('');
    expect(strip(textOf(out))).toBe(strip(textOf(input)));
  });

  it('preserves line breaks and indentation inside code blocks while removing stage-1 artifacts', () => {
    const out = ruleCleanDocument(
      doc([
        {
          type: 'code',
          language: 'ts',
          text: `${BOM}function test() {\r\n  return ${ZWSP}42;  \r\n}\n`,
          page: 1,
        },
      ]),
    );
    expect(out.blocks[0]).toEqual({
      type: 'code',
      language: 'ts',
      text: 'function test() {\n  return 42;\n}',
      page: 1,
    });
  });
});

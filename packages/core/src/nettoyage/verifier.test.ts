import { describe, expect, it } from 'vitest';
import { createDocument, type Block, type DocumentModel } from '../document-model';
import { ruleCleanDocument } from './rule-pass';
import {
  NETTOYAGE_REMOVABLE_NOISE,
  protectedProjection,
  verifyCleanedDocument,
  verifyCleanedText,
} from './verifier';

/** Build a character from a code point — keeps this source pure ASCII. */
const ch = (codePoint: number): string => String.fromCodePoint(codePoint);

const BOX_H = ch(0x2500); // box drawings light horizontal
const BOX_V = ch(0x2502); // box drawings light vertical
const BLOCK = ch(0x2588); // full block
const SHAPE = ch(0x25a0); // black square
const BAR = '|';
const BROKEN_BAR = ch(0xa6);
const NOT_SIGN = ch(0xac);
const GRAVE = '`';
const ZWSP = ch(0x200b);

const doc = (blocks: Block[]): DocumentModel =>
  createDocument({ type: 'pdf', pages: 1, provider: 'test' }, blocks);

const para = (text: string, page = 1): Block => ({ type: 'paragraph', text, page });

/**
 * An INDEPENDENT oracle for the removable-noise class, restated here so a typo
 * in the module's range table fails the exhaustive scan rather than agreeing
 * with itself.
 */
const EXPECTED_NOISE = [
  [0x0060, 0x0060],
  [0x007c, 0x007c],
  [0x00a6, 0x00a6],
  [0x00ac, 0x00ac],
  [0x2500, 0x257f],
  [0x2580, 0x259f],
  [0x25a0, 0x25ff],
] as const;

const inAny = (cp: number, ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([low, high]) => cp >= low && cp <= high);

describe('NETTOYAGE_REMOVABLE_NOISE — the deletable class (AC2)', () => {
  it('matches exactly the intended code points across the whole BMP', () => {
    const misses: number[] = [];
    for (let cp = 0; cp <= 0xffff; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (NETTOYAGE_REMOVABLE_NOISE.test(ch(cp)) !== inAny(cp, EXPECTED_NOISE)) misses.push(cp);
    }
    expect(misses).toEqual([]);
  });

  it('is exported non-global, so repeated .test() is stateless', () => {
    expect(NETTOYAGE_REMOVABLE_NOISE.global).toBe(false);
    for (let i = 0; i < 3; i += 1) expect(NETTOYAGE_REMOVABLE_NOISE.test(BAR)).toBe(true);
  });

  it('protects the characters that carry meaning', () => {
    // Letters, digits, accents, punctuation and currency must NEVER be deletable
    // — this is the line between a cleanup and a rewrite.
    for (const c of 'abzAZ09.,;:!?-_()[]{}\'"/\\+=<>%&*#@$~^' + ch(0x20ac) + ch(0xe9) + ch(0x301)) {
      expect(NETTOYAGE_REMOVABLE_NOISE.test(c)).toBe(false);
    }
  });

  it('projects away only noise', () => {
    expect(protectedProjection(`Total${BOX_V} 12.50`)).toBe('Total 12.50');
    expect(protectedProjection('Total 12.50')).toBe('Total 12.50');
  });
});

describe('verifier ACCEPTS (AC2, AC3 — the accept half of the suite)', () => {
  it('accepts an unchanged text', () => {
    expect(verifyCleanedText('Chapitre 3', 'Chapitre 3')).toEqual({ accepted: true });
  });

  it('accepts deletion of a box-drawing run', () => {
    const raw = `${BOX_H.repeat(12)} Total: 12,50 ${BOX_H.repeat(12)}`;
    expect(verifyCleanedText(raw, 'Total: 12,50')).toEqual({ accepted: true });
  });

  it('accepts deletion of each removable noise character', () => {
    for (const noise of [BOX_H, BOX_V, BLOCK, SHAPE, BAR, BROKEN_BAR, NOT_SIGN, GRAVE]) {
      expect(verifyCleanedText(`Total ${noise} 42`, 'Total 42')).toEqual({ accepted: true });
    }
  });

  it('accepts a whitespace-only difference (stage 1 normalizes both sides)', () => {
    expect(verifyCleanedText('a   b', 'a b')).toEqual({ accepted: true });
    expect(verifyCleanedText('  a b  ', 'a b')).toEqual({ accepted: true });
  });

  it('accepts a candidate that re-introduces a stage-1 artifact (it gets stripped)', () => {
    expect(verifyCleanedText('a b', `a${ZWSP} b`)).toEqual({ accepted: true });
  });

  it('accepts the empty text', () => {
    expect(verifyCleanedText('', '')).toEqual({ accepted: true });
  });

  it('accepts a text that is nothing but noise being emptied', () => {
    expect(verifyCleanedText(BOX_H.repeat(20), '')).toEqual({ accepted: true });
  });
});

describe('verifier REJECTS (AC2, AC3 — the reject half of the suite)', () => {
  const rejects = (raw: string, candidate: string, reason: string) => {
    const verdict = verifyCleanedText(raw, candidate);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toBe(reason);
  };

  it('rejects added content', () => {
    rejects('Total: 42', 'Total: 42 (approx.)', 'protected-content-removed');
    rejects('Total: 42', 'Total: 420', 'protected-content-removed');
  });

  it('rejects a deleted word', () => {
    rejects('Montant total: 42', 'Montant: 42', 'protected-content-removed');
  });

  it('rejects a deleted digit', () => {
    rejects('Total: 42', 'Total: 4', 'protected-content-removed');
  });

  it('rejects a deleted decimal point — 12.50 must never become 1250', () => {
    rejects('Total: 12.50', 'Total: 1250', 'protected-content-removed');
    rejects('Total: 12,50', 'Total: 1250', 'protected-content-removed');
  });

  it('rejects a deleted hyphen (it may be a real one)', () => {
    rejects('inter-national', 'international', 'protected-content-removed');
  });

  it('rejects a deleted currency symbol', () => {
    rejects(`12,50 ${ch(0x20ac)}`, '12,50', 'protected-content-removed');
  });

  it('rejects a deleted accent / combining mark', () => {
    rejects(`caf${ch(0xe9)}`, 'cafe', 'protected-content-removed');
    rejects(`cafe${ch(0x301)}`, 'cafe', 'protected-content-removed');
  });

  it('rejects reordered content', () => {
    rejects('alpha beta', 'beta alpha', 'protected-content-removed');
  });

  it('rejects a paraphrase', () => {
    rejects('The total amount is 42.', 'Total: 42.', 'protected-content-removed');
  });

  it('rejects a translation', () => {
    rejects('Montant total', 'Total amount', 'protected-content-removed');
  });

  it('rejects a substituted homoglyph (Cyrillic a for Latin a)', () => {
    rejects('data', `d${ch(0x430)}ta`, 'protected-content-removed');
  });

  it('rejects a case change — that is a rewrite, not a cleanup', () => {
    rejects('Total', 'total', 'protected-content-removed');
  });

  it('rejects added noise characters (nothing may be added at all)', () => {
    // Protected projections match, so this is caught by the subsequence check.
    rejects('Total 42', `Total ${BOX_H} 42`, 'content-not-a-subsequence');
  });

  it('rejects a noise deletion that would JOIN two protected characters', () => {
    // The regression this guards: a mis-read table border between two numbers.
    // Deleting it concatenates them into a different number, so the noise must
    // project to a separator, not to nothing.
    rejects('12|50', '1250', 'protected-content-removed');
    rejects('a|b', 'ab', 'protected-content-removed');
    rejects(`12${BOX_V}50`, '1250', 'protected-content-removed');
    rejects(`mot${BLOCK}suivant`, 'motsuivant', 'protected-content-removed');
  });

  it('still rejects the joined form even when the candidate keeps a separator it invented', () => {
    // "12|50" -> "12 50" preserves the separation but ADDS a space that was not
    // in the raw text, so the subsequence check catches it.
    rejects('12|50', '12 50', 'content-not-a-subsequence');
  });
});

describe('verifyCleanedDocument — structure is immutable (AC2)', () => {
  const base = doc([
    { type: 'heading', level: 2, text: `${BOX_H} Titre`, page: 1 },
    para('Corps du texte.', 1),
    { type: 'list', ordered: true, items: [`${BAR} un`, 'deux'], page: 2 },
    {
      type: 'table',
      rows: [
        ['h1', 'h2'],
        [`${BOX_V}a`, 'b'],
      ],
      page: 2,
    },
  ]);

  it('accepts a candidate that only deleted noise from text values', () => {
    const candidate = doc([
      { type: 'heading', level: 2, text: 'Titre', page: 1 },
      para('Corps du texte.', 1),
      { type: 'list', ordered: true, items: ['un', 'deux'], page: 2 },
      {
        type: 'table',
        rows: [
          ['h1', 'h2'],
          ['a', 'b'],
        ],
        page: 2,
      },
    ]);
    expect(verifyCleanedDocument(base, candidate)).toEqual({ accepted: true });
  });

  const rejectsStructure = (candidate: DocumentModel) => {
    const verdict = verifyCleanedDocument(base, candidate);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) expect(verdict.reason).toBe('structure-changed');
  };

  it('rejects a changed block count', () => {
    rejectsStructure(doc(base.blocks.slice(0, 3)));
    rejectsStructure(doc([...base.blocks, para('extra')]));
  });

  it('rejects a changed block type', () => {
    rejectsStructure(doc([para(`${BOX_H} Titre`, 1), ...base.blocks.slice(1)]));
  });

  it('rejects a changed block order', () => {
    rejectsStructure(
      doc([base.blocks[1] as Block, base.blocks[0] as Block, ...base.blocks.slice(2)]),
    );
  });

  it('rejects a changed heading level (hierarchy)', () => {
    rejectsStructure(
      doc([{ type: 'heading', level: 1, text: 'Titre', page: 1 }, ...base.blocks.slice(1)]),
    );
  });

  it('rejects a changed page', () => {
    rejectsStructure(
      doc([{ type: 'heading', level: 2, text: 'Titre', page: 7 }, ...base.blocks.slice(1)]),
    );
  });

  it('rejects a changed list ordering flag', () => {
    rejectsStructure(
      doc([
        ...base.blocks.slice(0, 2),
        { type: 'list', ordered: false, items: ['un', 'deux'], page: 2 },
        base.blocks[3] as Block,
      ]),
    );
  });

  it('rejects a changed list item count', () => {
    rejectsStructure(
      doc([
        ...base.blocks.slice(0, 2),
        { type: 'list', ordered: true, items: ['un'], page: 2 },
        base.blocks[3] as Block,
      ]),
    );
  });

  it('rejects a changed table shape', () => {
    rejectsStructure(
      doc([
        ...base.blocks.slice(0, 3),
        {
          type: 'table',
          rows: [
            ['h1', 'h2', 'h3'],
            ['a', 'b', 'c'],
          ],
          page: 2,
        },
      ]),
    );
  });

  it('rejects a text change inside an otherwise identical structure', () => {
    const candidate = doc([
      { type: 'heading', level: 2, text: 'Titre modifie', page: 1 },
      ...base.blocks.slice(1),
    ]);
    const verdict = verifyCleanedDocument(base, candidate);
    expect(verdict.accepted).toBe(false);
    if (!verdict.accepted) {
      expect(verdict.reason).toBe('protected-content-removed');
      expect(verdict.detail).toMatch(/text value 0/);
    }
  });
});

describe('verifying against raw === verifying against rule-only (AC2 "cleaned vs raw")', () => {
  // The orchestrator compares the candidate against the STAGE-1 document, while
  // AC2 words it as "cleaned vs raw". The two are provably the same verdict:
  // the verifier normalizes both sides with `ruleCleanText` first, and stage 1's
  // Story 3.1 invariant is that it preserves every visible character. This test
  // pins that equivalence so the shortcut can never silently weaken.
  const raws = [
    doc([para(`${ZWSP}Total${BOX_H} :  12,50`)]),
    doc([{ type: 'heading', level: 3, text: `  ${BLOCK}Titre  `, page: 2 }]),
    doc([{ type: 'list', ordered: true, items: [`${BAR}un`, `deux${GRAVE}`], page: 1 }]),
  ];

  const candidates = [
    doc([para('Total : 12,50')]),
    doc([{ type: 'heading', level: 3, text: 'Titre', page: 2 }]),
    doc([{ type: 'list', ordered: true, items: ['un', 'deux'], page: 1 }]),
    doc([para('Rewritten')]),
  ];

  it('yields the same verdict either way, for accepted and rejected candidates', () => {
    for (const raw of raws) {
      for (const candidate of candidates) {
        expect(verifyCleanedDocument(raw, candidate)).toEqual(
          verifyCleanedDocument(ruleCleanDocument(raw), candidate),
        );
      }
    }
  });
});

describe('verifier is pure and deterministic (AC2)', () => {
  it('returns the same verdict across repeated calls', () => {
    const raw = `${BOX_H} Total: 12,50 ${BAR}`;
    const first = verifyCleanedText(raw, 'Total: 12,50');
    const second = verifyCleanedText(raw, 'Total: 12,50');
    expect(first).toEqual(second);
    expect(first).toEqual({ accepted: true });
  });

  it('does not mutate the documents it compares', () => {
    const raw = doc([para(`${BOX_H} a`)]);
    const candidate = doc([para('a')]);
    const rawBefore = structuredClone(raw);
    const candidateBefore = structuredClone(candidate);
    verifyCleanedDocument(raw, candidate);
    expect(raw).toEqual(rawBefore);
    expect(candidate).toEqual(candidateBefore);
  });
});

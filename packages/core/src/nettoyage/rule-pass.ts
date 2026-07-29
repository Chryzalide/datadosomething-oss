/**
 * Nettoyage stage 1 — the deterministic rule pass (AD-8 / AR-9).
 *
 * The first of the three Nettoyage stages, and the only one that runs before any
 * model is involved. It removes known OCR-artifact character classes and
 * superfluous whitespace, and NOTHING else: no visible character is added,
 * removed, reordered, or substituted, and applied to the canonical Document
 * Model the structure is immutable (same blocks, same types, same order, same
 * `page`/`bbox`/`confidence`).
 *
 * The guarantee is stated as a machine-checkable invariant. Let `strip(s)` delete
 * every character matched by `OCR_ARTIFACT_CHARS` or `NETTOYAGE_WHITESPACE`;
 * then for all `s`:
 *
 *     strip(ruleCleanText(s)) === strip(s)
 *
 * The two classes are exported and disjoint precisely so stage 3 (the verifier,
 * Story 3.2) applies this same predicate to the LLM output — as a rejection
 * criterion there, as a guarantee here — instead of re-deriving "allowed change".
 *
 * Deliberately NOT done, because both alter visible glyphs and would make this a
 * rewrite rather than a cleanup:
 *   - end-of-line de-hyphenation ("inter-" + line break + "national" joined into
 *     "international"): it deletes a visible hyphen that may be a real one;
 *   - quote / dash / ligature folding (curly quotes to straight, em dash to
 *     hyphen, the fi ligature to two letters).
 *
 * Pure and deterministic (no Date, no random, no locale-sensitive operation), so
 * the rule-only Nettoyage state stays on the byte-parity path of the golden-file
 * harness (AD-14).
 */
import type { BBox, Block, DocumentModel } from '../document-model';
import { charClass, type CodePointRange } from './char-class';

/**
 * Invisible noise that carries no content, deleted outright:
 * C0 controls except tab/LF/VT/FF/CR, DEL + C1, the soft hyphen, the zero-width
 * / word-joiner / bidi-format ranges, the BOM, and the replacement character
 * U+FFFD (which *is* the OCR artifact, not evidence of content).
 */
const ARTIFACT_RANGES: readonly CodePointRange[] = [
  [0x0000, 0x0008], // C0 before tab
  [0x000e, 0x001f], // C0 after CR
  [0x007f, 0x009f], // DEL + C1
  [0x00ad, 0x00ad], // soft hyphen
  [0x200b, 0x200f], // zero-width space/non-joiner/joiner + LRM/RLM
  [0x202a, 0x202e], // bidi embedding/override
  [0x2060, 0x2064], // word joiner + invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xfffd, 0xfffd], // replacement character
];

/**
 * Whitespace: every member is normalized to a single U+0020 and consecutive runs
 * collapse to one. Includes the ASCII space itself, so `strip` removes it and
 * the non-alteration invariant above is expressible.
 */
const WHITESPACE_RANGES: readonly CodePointRange[] = [
  [0x0009, 0x000d], // tab, LF, VT, FF, CR
  [0x0020, 0x0020], // space
  [0x00a0, 0x00a0], // no-break space
  [0x1680, 0x1680], // ogham space mark
  [0x2000, 0x200a], // en/em quad through hair space
  [0x2028, 0x2029], // line + paragraph separator
  [0x202f, 0x202f], // narrow no-break space
  [0x205f, 0x205f], // medium mathematical space
  [0x3000, 0x3000], // ideographic space
];

/**
 * The OCR-artifact character class (AD-8's "known artifact classes").
 * Non-global on purpose: a global regex carries `lastIndex` state, which makes a
 * shared exported instance give alternating answers to `.test()`. Callers that
 * need to replace should build their own global copy, as this module does.
 * Disjoint from `NETTOYAGE_WHITESPACE`.
 */
export const OCR_ARTIFACT_CHARS = charClass(ARTIFACT_RANGES, 'u');

/** The whitespace character class. Non-global, for the same reason.
 *  Disjoint from `OCR_ARTIFACT_CHARS`. */
export const NETTOYAGE_WHITESPACE = charClass(WHITESPACE_RANGES, 'u');

/** Global variants used internally by `ruleCleanText`. Derived from the exported
 *  classes' own `source`, so what this module strips can never drift from what
 *  the exported contract says it strips. */
const ARTIFACTS_G = new RegExp(OCR_ARTIFACT_CHARS.source, 'gu');
const WHITESPACE_RUN_G = new RegExp(`${NETTOYAGE_WHITESPACE.source}+`, 'gu');

/**
 * Clean one plain-text value: delete artifacts, normalize every whitespace run
 * to a single space, trim the ends.
 *
 * The order is load-bearing: artifacts are deleted BEFORE whitespace collapses,
 * so a zero-width character sitting between two spaces leaves a single space
 * rather than a gap that survives because an invisible character kept the two
 * runs apart.
 */
export function ruleCleanText(value: string): string {
  return value.replace(ARTIFACTS_G, '').replace(WHITESPACE_RUN_G, ' ').trim();
}

/** Copy a block's non-text fields, sharing no object with the input model. */
function copyBase(block: Block): { page: number; bbox?: BBox; confidence?: number } {
  const base: { page: number; bbox?: BBox; confidence?: number } = { page: block.page };
  if (block.bbox) base.bbox = { ...block.bbox };
  if (block.confidence !== undefined) base.confidence = block.confidence;
  return base;
}

/**
 * Clean one block's in-block text. Type, order, level/ordered, page, bbox and
 * confidence are carried through untouched — AD-8 makes the model structure
 * immutable through Nettoyage. A block whose text cleans to the empty string is
 * KEPT: dropping it would be a structural change.
 */
function ruleCleanBlock(block: Block): Block {
  switch (block.type) {
    case 'heading':
      return {
        type: 'heading',
        level: block.level,
        text: ruleCleanText(block.text),
        ...copyBase(block),
      };
    case 'paragraph':
      return { type: 'paragraph', text: ruleCleanText(block.text), ...copyBase(block) };
    case 'list':
      return {
        type: 'list',
        ordered: block.ordered,
        items: block.items.map((item) => ruleCleanText(item)),
        ...copyBase(block),
      };
    case 'table':
      return {
        type: 'table',
        rows: block.rows.map((row) => row.map((cell) => ruleCleanText(cell))),
        ...copyBase(block),
      };
    default: {
      // The block set is closed (AD-4). Should an out-of-contract block ever
      // reach here at runtime, pass it through UNCHANGED: a cleanup pass must
      // never be the stage that breaks a conversion (AD-8 — on failure, serve
      // raw). `block` is `never` here, so this is a pure escape hatch.
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

/**
 * Stage 1 over the canonical Document Model: clean in-block text only. Pure —
 * returns a new model sharing no object with the input, which is never mutated.
 */
export function ruleCleanDocument(doc: DocumentModel): DocumentModel {
  return {
    version: doc.version,
    source: { ...doc.source },
    blocks: doc.blocks.map((block) => ruleCleanBlock(block)),
  };
}

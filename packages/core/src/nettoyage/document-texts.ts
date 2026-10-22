/**
 * The in-block text channel of the canonical Document Model.
 *
 * `flattenTexts` and `withTexts` are exact inverses over a document's in-block
 * text values, in a fixed order. Everything Nettoyage does to a document flows
 * through this pair, and that is what makes AD-8's structural guarantee
 * mechanical rather than aspirational: block types, hierarchy, order, `page`,
 * `level`, `ordered`, `bbox`, `confidence` and the table's row/column shape are
 * never part of the payload, so a model cannot alter them even in principle —
 * it only ever sees a list of strings.
 *
 * Pure; `withTexts` returns a new model sharing no mutable object with its input.
 */
import type { BBox, Block, DocumentModel } from '../document-model';

/** Copy a block's non-text fields, sharing no object with the input. */
function copyBase(block: Block): { page: number; bbox?: BBox; confidence?: number } {
  const base: { page: number; bbox?: BBox; confidence?: number } = { page: block.page };
  if (block.bbox) base.bbox = { ...block.bbox };
  if (block.confidence !== undefined) base.confidence = block.confidence;
  return base;
}

/** How many text values a block contributes. */
function blockTextCount(block: Block): number {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'code':
      return 1;
    case 'list':
      return block.items.length;
    case 'table':
      return block.rows.reduce((total, row) => total + row.length, 0);
    default: {
      const exhaustive: never = block;
      void exhaustive;
      return 0;
    }
  }
}

/** Total number of in-block text values in a document. */
export function textCount(doc: DocumentModel): number {
  return doc.blocks.reduce((total, block) => total + blockTextCount(block), 0);
}

/** Extract every in-block text value, in document order. */
export function flattenTexts(doc: DocumentModel): string[] {
  const texts: string[] = [];
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'code':
        texts.push(block.text);
        break;
      case 'list':
        texts.push(...block.items);
        break;
      case 'table':
        for (const row of block.rows) texts.push(...row);
        break;
      default: {
        const exhaustive: never = block;
        void exhaustive;
      }
    }
  }
  return texts;
}

/**
 * Rebuild a document with `texts` substituted back into its in-block text
 * positions, in the same order `flattenTexts` produced them. Structure is copied
 * verbatim from `doc`.
 *
 * Throws on a length mismatch: silently padding or truncating would be exactly
 * the semantic content loss AD-8 forbids. Callers hold a `textCount` check first
 * and turn a mismatch into a rule-only fallback.
 */
export function withTexts(doc: DocumentModel, texts: readonly string[]): DocumentModel {
  if (texts.length !== textCount(doc)) {
    throw new Error(
      `withTexts expected ${textCount(doc)} text values for this document, received ${texts.length}.`,
    );
  }

  let cursor = 0;
  const next = (): string => texts[cursor++] ?? '';

  const blocks = doc.blocks.map((block): Block => {
    switch (block.type) {
      case 'heading':
        return { type: 'heading', level: block.level, text: next(), ...copyBase(block) };
      case 'paragraph':
        return { type: 'paragraph', text: next(), ...copyBase(block) };
      case 'list':
        return {
          type: 'list',
          ordered: block.ordered,
          items: block.items.map(() => next()),
          ...copyBase(block),
        };
      case 'table':
        return {
          type: 'table',
          rows: block.rows.map((row) => row.map(() => next())),
          ...copyBase(block),
        };
      case 'code':
        return {
          type: 'code',
          ...(block.language !== undefined ? { language: block.language } : {}),
          text: next(),
          ...copyBase(block),
        };
      default: {
        // The block set is closed (AD-4); pass an out-of-contract block through
        // unchanged rather than let Nettoyage break a conversion.
        const exhaustive: never = block;
        return exhaustive;
      }
    }
  });

  return { version: doc.version, source: { ...doc.source }, blocks };
}

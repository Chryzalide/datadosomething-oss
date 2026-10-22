/**
 * JSON renderer — the second PURE projection of the canonical Document Model
 * (AD-3), emitting the versioned pdftojson public contract (AD-4). It is the
 * twin of `renderMarkdown`: same model in, structurally identical blocks out —
 * block types, order, and count are exactly the model's `blocks`, adding no
 * structure the model doesn't hold (FR-5, FR-6).
 *
 * Text handling is the deliberate INVERSE of the Markdown renderer: in-block
 * text (`text` / `items` / table cells) is carried VERBATIM and only
 * JSON-string-encoded by `JSON.stringify`. It is NEVER Markdown-escaped —
 * Markdown-escaping inside JSON would corrupt the data and break the pure
 * projection contract.
 *
 * Deterministic (no Date/random/locale): every object literal is built in a
 * fixed key order and serialized with `JSON.stringify(_, null, 2)`, so output
 * is byte-identical across renders and seeds the golden-file parity harness
 * (AD-14).
 */
import type { Block, BBox, DocumentModel, DocumentSource } from '../document-model';

/** The public contract version (AD-4). Kept distinct from the internal
 *  `DOCUMENT_MODEL_VERSION` so the public schema can version independently. */
export const PDFTOJSON_SCHEMA_VERSION = '1.0' as const;

/** Optional best-effort bounding box, public shape. */
export interface JsonBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface JsonBlockBase {
  page: number;
  bbox?: JsonBBox;
  confidence?: number;
}

export interface JsonHeadingBlock extends JsonBlockBase {
  type: 'heading';
  level: number;
  text: string;
}
export interface JsonParagraphBlock extends JsonBlockBase {
  type: 'paragraph';
  text: string;
}
export interface JsonListBlock extends JsonBlockBase {
  type: 'list';
  ordered: boolean;
  items: string[];
}
export interface JsonTableBlock extends JsonBlockBase {
  type: 'table';
  rows: string[][];
}
export interface JsonCodeBlock extends JsonBlockBase {
  type: 'code';
  language?: string;
  text: string;
}

/** A public block is exactly one of the closed set (discriminated by `type`). */
export type JsonBlock =
  JsonHeadingBlock | JsonParagraphBlock | JsonListBlock | JsonTableBlock | JsonCodeBlock;

/** Document-level provenance, public shape. */
export interface JsonSource {
  type: string;
  pages: number;
  provider: string;
}

/** The pdftojson public contract: a versioned, flat, ordered list of blocks. */
export interface JsonDocument {
  schema_version: typeof PDFTOJSON_SCHEMA_VERSION;
  source: JsonSource;
  blocks: JsonBlock[];
}

/**
 * Coerce a required integer field to one that both stays valid JSON and
 * satisfies the published schema's range. `JSON.stringify` emits `null` for
 * NaN/Infinity, so a non-finite value falls back; a finite value is truncated
 * to an integer and clamped into `[min, max]`. The clamp is what keeps
 * `renderJson` a valid instance of `PDFTOJSON_JSON_SCHEMA` even when the
 * (unconstrained `number`) model carries an out-of-range value from an adapter —
 * and keeps heading `level` in lockstep with the Markdown renderer's clamp.
 */
function boundedInt(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 1-based page: finite, integer, ≥ 1 (schema `minimum: 1`). */
function pageOf(value: number): number {
  return boundedInt(value, 1, Number.MAX_SAFE_INTEGER, 1);
}

/** Assemble the optional best-effort fields, omitting any that are absent or
 *  out of range (so both present and absent validate against the schema, and no
 *  out-of-range value ever violates the contract). */
function optionalFields(block: Block): { bbox?: JsonBBox; confidence?: number } {
  const out: { bbox?: JsonBBox; confidence?: number } = {};
  if (block.bbox) {
    const b: BBox = block.bbox;
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite)) {
      // Fixed key order for determinism.
      out.bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  }
  // confidence is best-effort in `[0, 1]` (schema): drop anything non-finite or
  // out of range rather than clamp — a clamp would fabricate a false certainty.
  if (
    block.confidence !== undefined &&
    Number.isFinite(block.confidence) &&
    block.confidence >= 0 &&
    block.confidence <= 1
  ) {
    out.confidence = block.confidence;
  }
  return out;
}

/** Project one model block to its public JSON block, preserving order/type and
 *  carrying text verbatim (no Markdown escaping). Keys in fixed order. */
function projectBlock(block: Block): JsonBlock {
  switch (block.type) {
    case 'heading':
      return {
        type: 'heading',
        // Clamp to h1..h6 — schema range + parity with renderMarkdown's clamp.
        level: boundedInt(block.level, 1, 6, 1),
        text: block.text,
        page: pageOf(block.page),
        ...optionalFields(block),
      };
    case 'paragraph':
      return {
        type: 'paragraph',
        text: block.text,
        page: pageOf(block.page),
        ...optionalFields(block),
      };
    case 'list':
      return {
        type: 'list',
        ordered: block.ordered,
        // Copy so the projection returns no live reference into the input model.
        items: [...block.items],
        page: pageOf(block.page),
        ...optionalFields(block),
      };
    case 'table':
      return {
        type: 'table',
        // Deep-copy rows so the projection shares no array with the input model.
        rows: block.rows.map((row) => [...row]),
        page: pageOf(block.page),
        ...optionalFields(block),
      };
    case 'code':
      return {
        type: 'code',
        ...(block.language !== undefined && block.language !== ''
          ? { language: block.language }
          : {}),
        text: block.text,
        page: pageOf(block.page),
        ...optionalFields(block),
      };
    default: {
      // Exhaustiveness: the block set is closed (AD-4). An out-of-contract block
      // must not silently corrupt the contract — fail loudly instead.
      const exhaustive: never = block;
      throw new Error(`Unknown block type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function projectSource(source: DocumentSource): JsonSource {
  return {
    type: source.type,
    // Page count: finite, integer, ≥ 0 (schema `minimum: 0`).
    pages: boundedInt(source.pages, 0, Number.MAX_SAFE_INTEGER, 0),
    provider: source.provider,
  };
}

/**
 * Project a Document Model to the pdftojson public contract object. Pure — block
 * types, order, and count are exactly `doc.blocks`; adds no structure.
 */
export function projectToJson(doc: DocumentModel): JsonDocument {
  return {
    schema_version: PDFTOJSON_SCHEMA_VERSION,
    source: projectSource(doc.source),
    blocks: doc.blocks.map(projectBlock),
  };
}

/** Project a Document Model to a deterministic pdftojson JSON string (2-space
 *  indent, no trailing newline — matching `renderMarkdown`). Pure. */
export function renderJson(doc: DocumentModel): string {
  return JSON.stringify(projectToJson(doc), null, 2);
}

/**
 * The canonical, versioned Document Model (AD-3 / AD-4).
 *
 * `core` defines ONE internal model; every OCR/reader adapter maps its provider
 * output into it, and every renderer (Markdown here, JSON in Story 2.1) is a
 * PURE PROJECTION that adds no structure the model doesn't hold.
 *
 * The block set is a **closed, versioned contract** — do not add block types or
 * structural fields beyond this set (it must stay parity-trivial across the two
 * renderers). No vendor/provider name may appear in any identifier here: the
 * model is engine-agnostic; adapters (later stories) carry the vendor name.
 */

/** Schema version of the model + its projections (AD-4). */
export const DOCUMENT_MODEL_VERSION = '1.0' as const;

/** The closed set of block discriminants (AD-4). */
export type BlockType = 'heading' | 'paragraph' | 'list' | 'table';

/** Optional best-effort bounding box (present iff a provider supplies it).
 *  The block's own `page` is the authoritative page location. */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fields every block carries. `page` is mandatory (AD-4); the rest are optional. */
interface BlockBase {
  /** 1-based page location of the block. */
  page: number;
  /** Optional best-effort layout box. */
  bbox?: BBox;
  /** Optional best-effort provider confidence, 0..1. */
  confidence?: number;
}

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  level: number;
  text: string;
}

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph';
  text: string;
}

export interface ListBlock extends BlockBase {
  type: 'list';
  ordered: boolean;
  items: string[];
}

export interface TableBlock extends BlockBase {
  type: 'table';
  rows: string[][];
}

/** A block is exactly one of the closed set (discriminated by `type`). */
export type Block = HeadingBlock | ParagraphBlock | ListBlock | TableBlock;

/** Document-level provenance (AD-4). Values are set by an adapter at runtime. */
export interface DocumentSource {
  /** e.g. "pdf" | "image" — the ingested source kind. */
  type: string;
  /** Page count of the source document. */
  pages: number;
  /** The engine that produced the model (a runtime value, not an identifier). */
  provider: string;
}

/** The one canonical model: a versioned, flat, ordered list of typed blocks. */
export interface DocumentModel {
  version: typeof DOCUMENT_MODEL_VERSION;
  source: DocumentSource;
  blocks: Block[];
}

/** Convenience factory that stamps the current model version. */
export function createDocument(source: DocumentSource, blocks: Block[]): DocumentModel {
  return { version: DOCUMENT_MODEL_VERSION, source, blocks };
}

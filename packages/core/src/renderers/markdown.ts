/**
 * Markdown renderer — a PURE, FAITHFUL projection of the canonical Document
 * Model (AD-3). It adds no structure the model doesn't hold: block `text` /
 * `items` / table cells are plain text, so Markdown-significant characters are
 * escaped and embedded newlines are collapsed — a paragraph whose text is
 * `# Title` renders the literal `# Title`, never an H1. Headings become `#`.. by
 * level, lists become Markdown lists, tables become GitHub-flavored Markdown
 * tables, and blocks are emitted in model order. Deterministic (no
 * Date/random/locale) so byte-identical output and the golden-file parity
 * harness (AD-14) hold.
 */
import type { Block, DocumentModel, HeadingBlock, ListBlock } from '../document-model';

/**
 * Escape inline Markdown-significant characters and collapse embedded newlines,
 * so a plain-text value renders as itself. Backslash is in the class, so it is
 * escaped in the same single pass (correct ordering, e.g. `a\|b` → `a\\\|b`).
 */
function escapeInline(value: string): string {
  return value.replace(/\r\n?|\n/g, ' ').replace(/[\\`*_{}[\]<|~]/g, '\\$&');
}

/**
 * Additionally escape a LINE-START block marker (ATX heading, blockquote,
 * bullet, setext, ordered-list) so plain text starting with one does not become
 * that block. Applied to paragraphs and list items (headings already sit in a
 * heading context; `*` bullets are handled by escapeInline).
 */
function escapeBlockLeading(value: string): string {
  return value
    .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3') // # .. ###### heading
    .replace(/^(\s*)([>=+-])(\s|$)/, '$1\\$2$3') // > blockquote, - / + bullet, = setext
    .replace(/^(\s*\d{1,9})([.)])(\s|$)/, '$1\\$2$3'); // 1. / 1) ordered list
}

/** Escape a value used as inline text in a paragraph or list item. */
function escapeText(value: string): string {
  return escapeBlockLeading(escapeInline(value));
}

function renderHeading(block: HeadingBlock): string {
  // Markdown supports h1–h6; clamp defensively (NaN → 1). Add no structure.
  const truncated = Number.isFinite(block.level) ? Math.trunc(block.level) : 1;
  const level = Math.min(Math.max(truncated, 1), 6);
  return `${'#'.repeat(level)} ${escapeInline(block.text)}`;
}

function renderList(block: ListBlock): string {
  if (block.items.length === 0) return '';
  return block.items
    .map((item, i) => (block.ordered ? `${i + 1}. ${escapeText(item)}` : `- ${escapeText(item)}`))
    .join('\n');
}

function renderTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  // Table width = the widest row, so no cell is ever dropped (data loss) and an
  // empty/short header still yields a consistent column count.
  const cols = Math.max(1, ...rows.map((row) => row.length));
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  const cellsOf = (row: string[]): string[] =>
    Array.from({ length: cols }, (_, i) => escapeInline(row[i] ?? ''));

  const headerLine = line(cellsOf(rows[0] ?? []));
  const separatorLine = line(Array.from({ length: cols }, () => '---'));
  const bodyLines = rows.slice(1).map((row) => line(cellsOf(row)));

  return [headerLine, separatorLine, ...bodyLines].join('\n');
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case 'heading':
      return renderHeading(block);
    case 'paragraph':
      return escapeText(block.text);
    case 'list':
      return renderList(block);
    case 'table':
      return renderTable(block.rows);
    default: {
      // Exhaustiveness: the block set is closed (AD-4). An out-of-contract block
      // reaching here at runtime renders as nothing rather than corrupting output.
      const exhaustive: never = block;
      void exhaustive;
      return '';
    }
  }
}

/** Project a Document Model to Markdown. Pure + deterministic. */
export function renderMarkdown(doc: DocumentModel): string {
  return doc.blocks
    .map(renderBlock)
    .filter((rendered) => rendered.length > 0)
    .join('\n\n');
}

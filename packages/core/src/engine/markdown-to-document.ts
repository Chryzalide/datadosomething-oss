/**
 * Markdown → canonical Document Model mapper (AD-3). Turns a provider's Markdown
 * (e.g. Jina Reader output) into the one internal model, so both renderers
 * (Markdown now, JSON in Story 2.1) project from the same pivot. Pure function.
 *
 * The AD-4 model is STRUCTURAL — it holds no inline formatting and a flat block
 * list — so inline emphasis is flattened to plain text and inline link/image
 * URLs are NOT retained (a known V1 limitation: the closed block set has no
 * field for them). Content is preserved where the model can hold it: blockquote
 * and code blocks become paragraphs, and nested list items are flattened into
 * their parent item rather than dropped. `page` is best-effort (Jina Markdown
 * has no page info → 1 for V1).
 */
import { marked, type Token, type Tokens } from 'marked';
import {
  type Block,
  createDocument,
  type DocumentModel,
  type DocumentSource,
} from '../document-model';

/** Flatten inline tokens to plain text (drop emphasis/link/image/html markers). */
function inlineText(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const token of tokens) {
    const node = token as { type: string; text?: string; tokens?: Token[] };
    if (node.type === 'html') continue; // strip raw inline HTML markup
    if (node.type === 'br') out += ' ';
    else if (Array.isArray(node.tokens)) out += inlineText(node.tokens);
    else if (typeof node.text === 'string') out += node.text;
  }
  return out;
}

/**
 * Flatten a list item's block tokens to a plain-text string: loose items
 * (multiple paragraphs) are space-joined, while nested sub-lists are preserved
 * as indented sub-list lines (`\n  - item` or `\n  1. item`) so list hierarchy
 * is retained across Markdown and JSON projections without dropping content.
 */
function itemText(tokens: Token[] | undefined, depth = 1): string {
  if (!tokens) return '';
  const inlineParts: string[] = [];
  const subListLines: string[] = [];
  const indent = '  '.repeat(depth);

  for (const token of tokens) {
    const node = token as {
      type: string;
      text?: string;
      ordered?: boolean;
      tokens?: Token[];
      items?: Tokens.ListItem[];
    };
    if (node.type === 'html' || node.type === 'space' || node.type === 'hr') {
      continue;
    }
    if (node.type === 'list' && Array.isArray(node.items)) {
      node.items.forEach((sub, idx) => {
        const subText = itemText(sub.tokens, depth + 1);
        if (subText.length > 0) {
          const marker = node.ordered ? `${idx + 1}.` : '-';
          subListLines.push(`${indent}${marker} ${subText}`);
        }
      });
    } else if (node.type === 'blockquote' && Array.isArray(node.tokens)) {
      const quoted = itemText(node.tokens, depth);
      if (quoted.length > 0) inlineParts.push(quoted);
    } else if (Array.isArray(node.tokens)) {
      const text = inlineText(node.tokens);
      if (text.length > 0) inlineParts.push(text);
    } else if (typeof node.text === 'string' && node.text.length > 0) {
      inlineParts.push(node.text);
    }
  }

  const head = inlineParts.join(' ');
  if (subListLines.length === 0) return head;
  return head.length > 0 ? `${head}\n${subListLines.join('\n')}` : subListLines.join('\n');
}

export function markdownToDocument(markdown: string, source: DocumentSource): DocumentModel {
  const page = 1;
  const blocks: Block[] = [];

  for (const token of marked.lexer(markdown)) {
    switch (token.type) {
      case 'heading':
        blocks.push({
          type: 'heading',
          level: token.depth,
          text: inlineText(token.tokens) || token.text,
          page,
        });
        break;
      case 'paragraph':
        blocks.push({ type: 'paragraph', text: inlineText(token.tokens) || token.text, page });
        break;
      case 'blockquote':
        // No blockquote block in the closed set — preserve its text as a paragraph.
        blocks.push({ type: 'paragraph', text: itemText(token.tokens) || token.text, page });
        break;
      case 'code': {
        const language = typeof token.lang === 'string' ? token.lang.trim() : '';
        blocks.push({
          type: 'code',
          ...(language ? { language } : {}),
          text: token.text,
          page,
        });
        break;
      }
      case 'list':
        blocks.push({
          type: 'list',
          ordered: Boolean(token.ordered),
          items: token.items.map((item: Tokens.ListItem) => itemText(item.tokens)),
          page,
        });
        break;
      case 'table':
        blocks.push({
          type: 'table',
          rows: [
            token.header.map((cell: Tokens.TableCell) => inlineText(cell.tokens) || cell.text),
            ...token.rows.map((row: Tokens.TableCell[]) =>
              row.map((cell: Tokens.TableCell) => inlineText(cell.tokens) || cell.text),
            ),
          ],
          page,
        });
        break;
      default:
        // Structural-only tokens (space/hr/html) carry no model content — skip.
        break;
    }
  }

  return createDocument(source, blocks);
}

import {
  convertToDocument,
  type DocumentModel,
  type DocumentSource,
  EngineConfigError,
  type EngineRegistry,
  type EngineSource,
  NoEngineAvailableError,
  renderJson,
  renderMarkdown,
} from '@datadosomething/core';
import { withConfigDocs } from './config';
import { applyNettoyage, type NettoyageReport } from './nettoyage';
import { parseEnabledFlag, selfhostNettoyageEnabled } from './nettoyage-config';
import { maxUploadBytes, validateUpload } from './upload';

/**
 * The one conversion path, parameterized by output kind (AD-3): FormData →
 * EngineSource → Document Model → Nettoyage → Markdown | JSON.
 *
 * The order matters and matches `apps/hub`'s routes exactly — extract once,
 * clean the MODEL, then project. That is what makes Story 4.4's hosted ↔
 * self-host parity achievable; cleaning rendered strings instead would drift.
 *
 * Pure envelope: no conversion logic lives here, only plumbing (AC1).
 */

export type OutputKind = 'markdown' | 'json';

export interface ConversionOutcome {
  status: number;
  /** JSON body to serialize. */
  body: Record<string, unknown>;
}

const ok = (
  kind: OutputKind,
  sortie: string,
  source: DocumentSource,
  report?: NettoyageReport,
): ConversionOutcome => ({
  status: 200,
  body: {
    [kind === 'markdown' ? 'markdown' : 'json']: sortie,
    source: {
      type: source.type,
      pages: source.pages,
      provider: source.provider,
    },
    ...(report ? { nettoyage: report } : {}),
  },
});

const fail = (status: number, error: string): ConversionOutcome => ({ status, body: { error } });

export interface ConvertOptions {
  engines: EngineRegistry;
  env?: Record<string, string | undefined>;
  /** Optional query-string override for `nettoyage=true|false`. */
  nettoyage?: string;
  /** Optional query-string page range specification (e.g. `1-5` or `1,3-5`). */
  pages?: string;
}

/**
 * Parse a 1-based page range specification such as `"1-5"`, `"2"`, or `"1,3-5"`.
 * Returns `null` when the specification is malformed.
 */
export function parsePageSelection(raw: string): Set<number> | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const selected = new Set<number>();
  for (const part of trimmed.split(',')) {
    const token = part.trim();
    if (!token) return null;
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        return null;
      }
      for (let p = start; p <= end; p += 1) selected.add(p);
      continue;
    }
    if (/^\d+$/.test(token)) {
      const page = Number(token);
      if (!Number.isInteger(page) || page < 1) return null;
      selected.add(page);
      continue;
    }
    return null;
  }
  return selected.size > 0 ? selected : null;
}

function filterDocumentPages(doc: DocumentModel, selectedPages: Set<number>): DocumentModel {
  const blocks = doc.blocks.filter((block) => selectedPages.has(block.page));
  const matchingPageCount = [...selectedPages].filter(
    (p) => p >= 1 && p <= Math.max(1, doc.source.pages),
  ).length;
  return {
    version: doc.version,
    source: {
      ...doc.source,
      pages: matchingPageCount > 0 ? matchingPageCount : blocks.length > 0 ? 1 : 0,
    },
    blocks,
  };
}

/** Turn the multipart form into an EngineSource, or explain why it cannot. */
async function readSource(
  form: FormData,
  limit: number,
): Promise<{ source: EngineSource } | { error: ConversionOutcome }> {
  const file = form.get('file');
  if (!(file instanceof File)) {
    return { error: fail(400, 'Attach a PDF, PNG, or JPG in the "file" field.') };
  }

  const verdict = validateUpload({ type: file.type, size: file.size, name: file.name }, limit);
  if (!verdict.ok) {
    if (verdict.reason === 'size') {
      return {
        error: fail(
          413,
          `That file is over the ${limit} byte bound. Raise MAX_UPLOAD_BYTES, or set it to 0 to lift the bound.`,
        ),
      };
    }
    if (verdict.reason === 'empty') return { error: fail(400, 'That file is empty.') };
    return { error: fail(415, 'Unsupported file type — upload a PDF, PNG, or JPG.') };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    source:
      verdict.kind === 'image'
        ? { kind: 'image', bytes, mimeType: verdict.mimeType, filename: file.name || 'scan' }
        : { kind: 'pdf', bytes, filename: file.name || 'document.pdf' },
  };
}

export async function convert(
  kind: OutputKind,
  form: FormData,
  options: ConvertOptions,
): Promise<ConversionOutcome> {
  const env = options.env ?? process.env;

  const read = await readSource(form, maxUploadBytes(env));
  if ('error' in read) return read.error;

  const formPages = form.get('pages');
  const rawPages =
    typeof formPages === 'string' && formPages.trim() !== ''
      ? formPages.trim()
      : options.pages?.trim();
  let selectedPages: Set<number> | undefined;
  if (rawPages) {
    const parsed = parsePageSelection(rawPages);
    if (!parsed) {
      return fail(
        400,
        'Invalid "pages" range — use 1-based page numbers or ranges such as "1-5" or "1,3-5".',
      );
    }
    selectedPages = parsed;
  }

  const formNettoyage = form.get('nettoyage');
  const rawNettoyage =
    typeof formNettoyage === 'string' && formNettoyage.trim() !== ''
      ? formNettoyage.trim()
      : options.nettoyage?.trim();
  const nettoyageOverride =
    rawNettoyage !== undefined && rawNettoyage !== ''
      ? parseEnabledFlag(rawNettoyage, selfhostNettoyageEnabled(env))
      : undefined;

  try {
    const extracted = await convertToDocument(read.source, options.engines);
    const doc = selectedPages ? filterDocumentPages(extracted, selectedPages) : extracted;
    const { document, report } = await applyNettoyage(
      doc,
      env,
      nettoyageOverride !== undefined ? { enabled: nettoyageOverride } : {},
    );
    return ok(
      kind,
      kind === 'markdown' ? renderMarkdown(document) : renderJson(document),
      document.source,
      report,
    );
  } catch (cause) {
    // A missing OR REJECTED key must never be an opaque crash (FR-14, UX-DR10).
    // `EngineAuthError extends EngineConfigError`, so a 401/403 from any provider
    // lands here too and is reported as a configuration problem naming the
    // variable — not as a generic conversion failure the operator cannot act on.
    // `core` supplies the variable name; the app adds the docs link (AD-2).
    if (cause instanceof EngineConfigError || cause instanceof NoEngineAvailableError) {
      return fail(503, withConfigDocs(cause.message, env));
    }
    const detail = cause instanceof Error ? cause.message : 'Unknown error.';
    return fail(502, `Conversion failed — ${detail}`);
  }
}

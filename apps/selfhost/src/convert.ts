import {
  convertToDocument,
  EngineConfigError,
  type EngineRegistry,
  type EngineSource,
  NoEngineAvailableError,
  renderJson,
  renderMarkdown,
} from '@datadosomething/core';
import { withConfigDocs } from './config';
import { applyNettoyage, type NettoyageReport } from './nettoyage';
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

const ok = (kind: OutputKind, sortie: string, report?: NettoyageReport): ConversionOutcome => ({
  status: 200,
  body: {
    [kind === 'markdown' ? 'markdown' : 'json']: sortie,
    ...(report ? { nettoyage: report } : {}),
  },
});

const fail = (status: number, error: string): ConversionOutcome => ({ status, body: { error } });

export interface ConvertOptions {
  engines: EngineRegistry;
  env?: Record<string, string | undefined>;
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

  try {
    const doc = await convertToDocument(read.source, options.engines);
    const { document, report } = await applyNettoyage(doc, env);
    return ok(kind, kind === 'markdown' ? renderMarkdown(document) : renderJson(document), report);
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

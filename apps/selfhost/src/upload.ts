/**
 * Upload acceptance for the self-hosted envelope.
 *
 * A twin of `apps/hub/lib/upload-limits.ts` (AD-1 — selfhost ships without the
 * hub) with one deliberate difference: the byte bound here is a **stability**
 * guard, not a quota.
 *
 * AC1 forbids quotas, rate limits and page caps in self-host — the operator owns
 * the cost. But an unbounded upload is a memory-exhaustion foot-gun on the
 * operator's own box, so a generous default (100 MB, five times the hosted cap)
 * is applied and is overridable with `MAX_UPLOAD_BYTES`. Set it to `0` to lift
 * the bound entirely.
 */

export const ACCEPTED_PDF_MIME = 'application/pdf' as const;
export const ACCEPTED_IMAGE_MIMES = ['image/png', 'image/jpeg'] as const;
export type ImageMime = (typeof ACCEPTED_IMAGE_MIMES)[number];

/** `accept` attribute for the UI's file input. */
export const UPLOAD_ACCEPT_ATTR =
  '.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg' as const;

/** Default stability bound — NOT a quota. Generous on purpose. */
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Resolve the byte bound from the environment. `0` (or negative) means no bound. */
export function maxUploadBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MAX_UPLOAD_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_UPLOAD_BYTES;
  const parsed = Number(raw);
  // An unparseable value falls back to the default rather than accidentally
  // lifting or zeroing the bound.
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return Math.trunc(parsed);
}

export type UploadVerdict =
  | { ok: true; kind: 'pdf' }
  | { ok: true; kind: 'image'; mimeType: ImageMime }
  | { ok: false; reason: 'type' | 'size' | 'empty' };

/** Detect by MIME, falling back to the file extension for sources that omit one. */
function detectMime(input: { type: string; name?: string }): 'pdf' | ImageMime | null {
  const name = input.name?.toLowerCase() ?? '';
  if (input.type === ACCEPTED_PDF_MIME || name.endsWith('.pdf')) return 'pdf';
  if (input.type === 'image/png' || name.endsWith('.png')) return 'image/png';
  if (input.type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg'))
    return 'image/jpeg';
  return null;
}

export function validateUpload(
  input: { type: string; size: number; name?: string },
  limit: number = DEFAULT_MAX_UPLOAD_BYTES,
): UploadVerdict {
  const detected = detectMime(input);
  if (detected === null) return { ok: false, reason: 'type' };
  if (input.size <= 0) return { ok: false, reason: 'empty' };
  if (limit > 0 && input.size > limit) return { ok: false, reason: 'size' };
  return detected === 'pdf'
    ? { ok: true, kind: 'pdf' }
    : { ok: true, kind: 'image', mimeType: detected };
}

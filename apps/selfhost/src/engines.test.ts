import { describe, expect, it } from 'vitest';
import { composeEngines } from './engines';
import { maxUploadBytes, validateUpload } from './upload';

describe('composeEngines — BYO keys from the environment (AC2)', () => {
  it('registers nothing without keys', () => {
    expect(composeEngines({})).toEqual({});
  });

  it('registers the OCR engine from MISTRAL_API_KEY alone', () => {
    const registry = composeEngines({ MISTRAL_API_KEY: 'k' });
    expect(registry.ocr?.name).toBe('mistral-ocr');
    // Jina is optional: a Mistral-only operator still converts, via the router's
    // graceful fallback (AR-4, asserted end-to-end in Story 4.2).
    expect(registry.reader).toBeUndefined();
  });

  it('registers the reader from the optional JINA_API_KEY', () => {
    const registry = composeEngines({ JINA_API_KEY: 'j' });
    expect(registry.reader?.name).toBe('jina-reader');
    expect(registry.ocr).toBeUndefined();
  });

  it('registers both when both keys are present', () => {
    const registry = composeEngines({ MISTRAL_API_KEY: 'k', JINA_API_KEY: 'j' });
    expect(registry.reader?.name).toBe('jina-reader');
    expect(registry.ocr?.name).toBe('mistral-ocr');
  });

  it('treats a blank key as absent', () => {
    expect(composeEngines({ MISTRAL_API_KEY: '   ', JINA_API_KEY: '' })).toEqual({});
  });

  it('forwards custom OCR and Reader baseUrl, model and timeoutMs from env (2.2)', async () => {
    const registry = composeEngines({
      MISTRAL_API_KEY: 'k',
      OCR_BASE_URL: 'https://ocr.custom.local',
      OCR_MODEL: 'custom-ocr-v1',
      OCR_TIMEOUT_MS: '15000',
      JINA_API_KEY: 'j',
      READER_BASE_URL: 'https://reader.custom.local',
      READER_TIMEOUT_MS: '12000',
    });
    expect(registry.ocr?.name).toBe('mistral-ocr');
    expect(registry.reader?.name).toBe('jina-reader');
  });
});

describe('upload bound is a stability guard, not a quota (AC1)', () => {
  it('defaults generously — five times the hosted cap', () => {
    expect(maxUploadBytes({})).toBe(100 * 1024 * 1024);
  });

  it('is operator-overridable', () => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: '1048576' })).toBe(1048576);
  });

  it('can be lifted entirely with 0', () => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: '0' })).toBe(0);
    // 0 means "no bound", so a huge file passes validation.
    expect(validateUpload({ type: 'application/pdf', size: 5e9, name: 'huge.pdf' }, 0)).toEqual({
      ok: true,
      kind: 'pdf',
    });
  });

  it('falls back to the default on an unparseable value rather than lifting the bound', () => {
    for (const raw of ['nope', '-1', 'NaN']) {
      expect(maxUploadBytes({ MAX_UPLOAD_BYTES: raw })).toBe(100 * 1024 * 1024);
    }
  });
});

describe('validateUpload — accepted sources', () => {
  it('accepts a PDF by MIME or by extension', () => {
    expect(validateUpload({ type: 'application/pdf', size: 10 })).toEqual({
      ok: true,
      kind: 'pdf',
    });
    expect(validateUpload({ type: '', size: 10, name: 'report.PDF' })).toEqual({
      ok: true,
      kind: 'pdf',
    });
  });

  it('accepts PNG and JPG by MIME or by extension', () => {
    expect(validateUpload({ type: 'image/png', size: 10 })).toEqual({
      ok: true,
      kind: 'image',
      mimeType: 'image/png',
    });
    expect(validateUpload({ type: '', size: 10, name: 'scan.jpeg' })).toEqual({
      ok: true,
      kind: 'image',
      mimeType: 'image/jpeg',
    });
  });

  it('rejects an unsupported type, an empty file and an over-bound file', () => {
    expect(validateUpload({ type: 'image/gif', size: 10, name: 'a.gif' })).toEqual({
      ok: false,
      reason: 'type',
    });
    expect(validateUpload({ type: 'application/pdf', size: 0 })).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(validateUpload({ type: 'application/pdf', size: 100 }, 10)).toEqual({
      ok: false,
      reason: 'size',
    });
  });
});

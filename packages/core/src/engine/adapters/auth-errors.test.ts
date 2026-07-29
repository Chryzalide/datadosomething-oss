import { describe, expect, it, vi } from 'vitest';
import { EngineAuthError, EngineConfigError, isAuthStatus } from '../port';
import { JinaReaderAdapter } from './jina-reader-adapter';
import { MistralOcrAdapter } from './mistral-ocr-adapter';

/**
 * Story 4.2 AC1 — a REJECTED key is a configuration problem, not a conversion
 * failure. Without this distinction an operator cannot tell a bad key from a
 * provider outage, which is exactly the "opaque failure" FR-14 forbids.
 */

const pdf = { kind: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]), filename: 'r.pdf' } as const;
const image = {
  kind: 'image',
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mimeType: 'image/png',
} as const;

const status = (code: number) => vi.fn(async () => new Response('nope', { status: code }));

describe('isAuthStatus', () => {
  it('is exactly 401 and 403', () => {
    expect([401, 403].every(isAuthStatus)).toBe(true);
    expect([200, 400, 404, 429, 500, 502].some(isAuthStatus)).toBe(false);
  });
});

describe('EngineAuthError is a config error (the property both apps rely on)', () => {
  it('extends EngineConfigError, so existing 503 branches pick it up unchanged', () => {
    const error = new EngineAuthError('rejected');
    expect(error).toBeInstanceOf(EngineConfigError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EngineAuthError');
  });
});

describe('JinaReaderAdapter — rejected credential (AC1)', () => {
  it.each([401, 403])('throws EngineAuthError naming JINA_API_KEY on %i', async (code) => {
    const adapter = new JinaReaderAdapter({ apiKey: 'bad', fetch: status(code) });
    await expect(adapter.extract(pdf)).rejects.toThrow(EngineAuthError);
    await expect(adapter.extract(pdf)).rejects.toThrow(/JINA_API_KEY/);
    // And it is still a config error, so the app maps it to 503.
    await expect(adapter.extract(pdf)).rejects.toThrow(EngineConfigError);
  });

  it('leaves other failures generic — an outage is not a config problem', async () => {
    const adapter = new JinaReaderAdapter({ apiKey: 'k', fetch: status(500) });
    await expect(adapter.extract(pdf)).rejects.toThrow(/HTTP 500/);
    await expect(adapter.extract(pdf)).rejects.not.toThrow(EngineConfigError);
  });
});

describe('MistralOcrAdapter — rejected credential (AC1)', () => {
  it.each([401, 403])('throws EngineAuthError naming MISTRAL_API_KEY on %i', async (code) => {
    const adapter = new MistralOcrAdapter({ apiKey: 'bad', fetch: status(code) });
    await expect(adapter.extract(image)).rejects.toThrow(EngineAuthError);
    await expect(adapter.extract(image)).rejects.toThrow(/MISTRAL_API_KEY/);
    await expect(adapter.extract(image)).rejects.toThrow(EngineConfigError);
  });

  it('leaves other failures generic', async () => {
    const adapter = new MistralOcrAdapter({ apiKey: 'k', fetch: status(429) });
    await expect(adapter.extract(image)).rejects.toThrow(/HTTP 429/);
    await expect(adapter.extract(image)).rejects.not.toThrow(EngineConfigError);
  });
});

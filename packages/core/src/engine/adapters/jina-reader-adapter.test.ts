import { describe, expect, it, vi } from 'vitest';
import { EngineConfigError } from '../port';
import { JinaReaderAdapter } from './jina-reader-adapter';
import { jsonFetch } from '../../__testing__/json-fetch';

const pdf = { kind: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]), filename: 'r.pdf' } as const;

describe('JinaReaderAdapter (AC1)', () => {
  it('throws EngineConfigError on an empty key (FR-14)', () => {
    expect(() => new JinaReaderAdapter({ apiKey: '' })).toThrow(EngineConfigError);
  });

  it('POSTs a multipart file with Bearer auth and maps data.content', async () => {
    const fetchImpl = jsonFetch(200, { data: { content: '# Hi\n\nBody.' } });
    const doc = await new JinaReaderAdapter({ apiKey: 'k', fetch: fetchImpl }).extract(pdf);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0];
    const url = call?.[0];
    const init = call?.[1];
    expect(url).toBe('https://r.jina.ai/');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers.Accept).toBe('application/json');
    expect(headers['X-Respond-With']).toBe('markdown');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('file')).toBeInstanceOf(Blob);

    expect(doc.source.provider).toBe('jina-reader');
    expect(doc.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Hi', page: 1 },
      { type: 'paragraph', text: 'Body.', page: 1 },
    ]);
  });

  it('throws on a non-2xx response', async () => {
    const adapter = new JinaReaderAdapter({ apiKey: 'k', fetch: jsonFetch(429, 'rate limited') });
    await expect(adapter.extract(pdf)).rejects.toThrow(/429/);
  });

  it('throws on a malformed response (no data.content)', async () => {
    const adapter = new JinaReaderAdapter({ apiKey: 'k', fetch: jsonFetch(200, { data: {} }) });
    await expect(adapter.extract(pdf)).rejects.toThrow(/unexpected response/);
  });

  it('throws on empty content (never a silent zero-block success)', async () => {
    const adapter = new JinaReaderAdapter({
      apiKey: 'k',
      fetch: jsonFetch(200, { data: { content: '   ' } }),
    });
    await expect(adapter.extract(pdf)).rejects.toThrow(/empty content/);
  });

  it('throws a mapped error on a non-JSON 200 body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>not json</html>', { status: 200 }));
    const adapter = new JinaReaderAdapter({ apiKey: 'k', fetch: fetchImpl });
    await expect(adapter.extract(pdf)).rejects.toThrow(/non-JSON/);
  });

  it('wraps a network failure into an actionable error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const adapter = new JinaReaderAdapter({ apiKey: 'k', fetch: fetchImpl });
    await expect(adapter.extract(pdf)).rejects.toThrow(/network error/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../../renderers/markdown';
import { EngineConfigError } from '../port';
import {
  MISTRAL_OCR_PROVIDER,
  MistralOcrAdapter,
  mistralOcrEnvelopeToDocument,
} from './mistral-ocr-adapter';
import { jsonFetch } from '../../__testing__/json-fetch';

const image = {
  kind: 'image',
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mimeType: 'image/png',
  filename: 'scan.png',
} as const;

const pdf = { kind: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]), filename: 'r.pdf' } as const;

function onePage(markdown: string) {
  return { pages: [{ index: 0, markdown }] };
}

describe('MistralOcrAdapter (Story 1.6 AC1/AC2)', () => {
  it('throws EngineConfigError on an empty key (FR-14)', () => {
    expect(() => new MistralOcrAdapter({ apiKey: '' })).toThrow(EngineConfigError);
    expect(() => new MistralOcrAdapter({ apiKey: '   ' })).toThrow(EngineConfigError);
  });

  it('POSTs an image_url data URL with Bearer auth for an image source', async () => {
    const fetchImpl = jsonFetch(200, onePage('# Hi\n\nBody.'));
    const doc = await new MistralOcrAdapter({ apiKey: 'k', fetch: fetchImpl }).extract(image);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://api.mistral.ai/v1/ocr');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers['Content-Type']).toBe('application/json');
    const payload = JSON.parse(init?.body as string) as {
      model: string;
      document: { type: string; image_url?: string; document_url?: string };
    };
    expect(payload.model).toBe('mistral-ocr-latest');
    expect(payload.document.type).toBe('image_url');
    expect(payload.document.image_url).toMatch(/^data:image\/png;base64,/);

    // Same model + renderer as the digital path ⇒ rendering parity (AC2).
    expect(doc.source.provider).toBe('mistral-ocr');
    expect(doc.source.type).toBe('image');
    expect(doc.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Hi', page: 1 },
      { type: 'paragraph', text: 'Body.', page: 1 },
    ]);
    expect(renderMarkdown(doc)).toBe('# Hi\n\nBody.');
  });

  it('sends a document_url data URL for a PDF source (image-only/ambiguous PDF path)', async () => {
    const fetchImpl = jsonFetch(200, onePage('Text.'));
    await new MistralOcrAdapter({ apiKey: 'k', fetch: fetchImpl }).extract(pdf);
    const init = fetchImpl.mock.calls[0]?.[1];
    const payload = JSON.parse(init?.body as string) as {
      document: { type: string; document_url?: string };
    };
    expect(payload.document.type).toBe('document_url');
    expect(payload.document.document_url).toMatch(/^data:application\/pdf;base64,/);
  });

  it('maps multi-page markdown into one model, page-stamped by page number', async () => {
    const fetchImpl = jsonFetch(200, {
      pages: [
        { index: 0, markdown: '# Page one' },
        { index: 1, markdown: '## Page two\n\n- a\n- b' },
      ],
    });
    const doc = await new MistralOcrAdapter({ apiKey: 'k', fetch: fetchImpl }).extract(image);
    expect(doc.source.pages).toBe(2);
    expect(doc.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Page one', page: 1 },
      { type: 'heading', level: 2, text: 'Page two', page: 2 },
      { type: 'list', ordered: false, items: ['a', 'b'], page: 2 },
    ]);
  });

  it('falls back to array position when a page index is absent', async () => {
    const fetchImpl = jsonFetch(200, {
      pages: [{ markdown: 'One.' }, { markdown: 'Two.' }],
    });
    const doc = await new MistralOcrAdapter({ apiKey: 'k', fetch: fetchImpl }).extract(image);
    expect(doc.blocks.map((b) => b.page)).toEqual([1, 2]);
  });

  it('throws on a non-2xx response', async () => {
    const adapter = new MistralOcrAdapter({ apiKey: 'k', fetch: jsonFetch(429, 'rate limited') });
    await expect(adapter.extract(image)).rejects.toThrow(/429/);
  });

  it('throws on a missing/empty pages array (never a silent zero-block success)', async () => {
    await expect(
      new MistralOcrAdapter({ apiKey: 'k', fetch: jsonFetch(200, { pages: [] }) }).extract(image),
    ).rejects.toThrow(/missing pages/);
    await expect(
      new MistralOcrAdapter({ apiKey: 'k', fetch: jsonFetch(200, {}) }).extract(image),
    ).rejects.toThrow(/missing pages/);
  });

  it('throws when no page carries string markdown', async () => {
    const adapter = new MistralOcrAdapter({
      apiKey: 'k',
      fetch: jsonFetch(200, { pages: [{ index: 0, markdown: null }] }),
    });
    await expect(adapter.extract(image)).rejects.toThrow(/no readable page content/);
  });

  it('throws a mapped error on a non-JSON 200 body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>nope</html>', { status: 200 }));
    const adapter = new MistralOcrAdapter({ apiKey: 'k', fetch: fetchImpl });
    await expect(adapter.extract(image)).rejects.toThrow(/non-JSON/);
  });

  it('wraps a network failure into an actionable error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const adapter = new MistralOcrAdapter({ apiKey: 'k', fetch: fetchImpl });
    await expect(adapter.extract(image)).rejects.toThrow(/network error/);
  });
});

/**
 * The envelope→Document pivot on its own (Story 5.8).
 *
 * `extract` is one of its two callers; the other is `apps/hub`'s Batch delivery,
 * which never makes a request at all — it reads the same envelope out of a
 * downloaded result file hours later. Asserting the function directly is what
 * makes that second caller's behaviour a tested thing rather than an inherited
 * hope, and the last case here is the whole reason it is a separate export: the
 * batch path's input is parsed JSON of entirely unknown shape.
 */
describe('mistralOcrEnvelopeToDocument (Story 5.8 — one pivot, two transports)', () => {
  it('maps an envelope exactly as extract does, without any transport', async () => {
    const envelope = {
      pages: [
        { index: 0, markdown: '# Title\n\nOne.' },
        { index: 1, markdown: 'Two.' },
      ],
    };
    const direct = mistralOcrEnvelopeToDocument(envelope, { kind: 'pdf' });
    const viaAdapter = await new MistralOcrAdapter({
      apiKey: 'k',
      fetch: jsonFetch(200, envelope),
    }).extract(pdf);

    // Byte-identical models, so a batch-delivered Sortie and a realtime one are
    // the same Sortie. If these ever diverge, two copies of a parser exist again.
    expect(direct).toEqual(viaAdapter);
    expect(renderMarkdown(direct)).toBe(renderMarkdown(viaAdapter));
  });

  it('re-stamps the real 1-based page number from index, and falls back to position', () => {
    const doc = mistralOcrEnvelopeToDocument(
      { pages: [{ index: 4, markdown: 'Five.' }, { markdown: 'Six.' }] },
      { kind: 'pdf' },
    );
    expect(doc.blocks.map((block) => block.page)).toEqual([5, 2]);
    expect(doc.source.pages).toBe(2);
    expect(doc.source.provider).toBe(MISTRAL_OCR_PROVIDER);
  });

  it('refuses an envelope with no pages, and one with no readable page', () => {
    expect(() => mistralOcrEnvelopeToDocument({ pages: [] }, { kind: 'pdf' })).toThrow(
      /missing pages/,
    );
    expect(() => mistralOcrEnvelopeToDocument({}, { kind: 'pdf' })).toThrow(/missing pages/);
    expect(() =>
      mistralOcrEnvelopeToDocument({ pages: [{ index: 0, markdown: null }] }, { kind: 'pdf' }),
    ).toThrow(/no readable page content/);
  });

  it('refuses anything that is not an envelope at all, rather than throwing on a property', () => {
    // The batch caller hands it whatever a downloaded JSONL line parsed to. A
    // `TypeError: cannot read properties of null` there would surface to a
    // paying user as an unexplained 502 instead of the curated refusal.
    for (const rubbish of [null, undefined, 'nope', 42, [], { pages: 'yes' }]) {
      expect(() => mistralOcrEnvelopeToDocument(rubbish, { kind: 'pdf' })).toThrow(/missing pages/);
    }
  });
});

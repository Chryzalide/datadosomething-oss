import { describe, expect, it, vi } from 'vitest';
import { createDocument, type Block, type DocumentModel } from '../document-model';
import { flattenTexts, textCount, withTexts } from './document-texts';
import type { LlmCompletionRequest, LlmProvider } from './llm-port';
import { NETTOYAGE_SYSTEM_PROMPT, runLlmCleanupPass } from './llm-pass';

const doc = (blocks: Block[]): DocumentModel =>
  createDocument({ type: 'pdf', pages: 2, provider: 'test' }, blocks);

const sample = doc([
  { type: 'heading', level: 2, text: 'Titre', page: 1, confidence: 0.8 },
  { type: 'paragraph', text: 'Corps.', page: 1, bbox: { x: 1, y: 2, width: 3, height: 4 } },
  { type: 'list', ordered: true, items: ['un', 'deux'], page: 2 },
  {
    type: 'table',
    rows: [
      ['h1', 'h2'],
      ['a', 'b'],
    ],
    page: 2,
  },
]);

/** A provider stub that records its requests and replies with `reply`. */
function stubProvider(reply: string | (() => never)): LlmProvider & {
  calls: LlmCompletionRequest[];
} {
  const calls: LlmCompletionRequest[] = [];
  return {
    name: 'stub',
    calls,
    complete: vi.fn(async (request: LlmCompletionRequest): Promise<string> => {
      calls.push(request);
      if (typeof reply === 'function') {
        reply();
        // `reply` is typed `() => never`, so reaching here means a caller passed
        // a function that returns instead of throwing. Saying so beats returning
        // a function where the provider contract promises a string, which is what
        // the untypechecked version silently did.
        throw new Error('stubProvider: the reply function was expected to throw.');
      }
      return reply;
    }),
  };
}

describe('flattenTexts / withTexts — the text channel (AC1)', () => {
  it('flattens every in-block text value in document order', () => {
    expect(flattenTexts(sample)).toEqual(['Titre', 'Corps.', 'un', 'deux', 'h1', 'h2', 'a', 'b']);
    expect(textCount(sample)).toBe(8);
  });

  it('round-trips: withTexts(doc, flattenTexts(doc)) equals doc', () => {
    expect(withTexts(sample, flattenTexts(sample))).toEqual(sample);
  });

  it('substitutes texts back while carrying structure verbatim', () => {
    const out = withTexts(sample, ['T', 'C', '1', '2', 'A', 'B', 'x', 'y']);
    expect(flattenTexts(out)).toEqual(['T', 'C', '1', '2', 'A', 'B', 'x', 'y']);
    expect(out.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'table']);
    expect(out.blocks.map((b) => b.page)).toEqual([1, 1, 2, 2]);
    expect(out.blocks[0]).toMatchObject({ level: 2, confidence: 0.8 });
    expect(out.blocks[1]?.bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    const table = out.blocks[3];
    if (table?.type === 'table') expect(table.rows.map((r) => r.length)).toEqual([2, 2]);
  });

  it('throws on a length mismatch rather than padding or truncating', () => {
    expect(() => withTexts(sample, ['only-one'])).toThrow(/expected 8 text values/);
  });

  it('does not mutate the input document', () => {
    const before = structuredClone(sample);
    withTexts(sample, ['T', 'C', '1', '2', 'A', 'B', 'x', 'y']);
    expect(sample).toEqual(before);
  });
});

describe('runLlmCleanupPass — request shape (AC1)', () => {
  it('sends the bounding prompt as system and the texts as a JSON array', async () => {
    const provider = stubProvider(JSON.stringify(flattenTexts(sample)));
    const result = await runLlmCleanupPass(sample, provider);

    expect(result.ok).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.system).toBe(NETTOYAGE_SYSTEM_PROMPT);
    expect(JSON.parse(provider.calls[0]?.user ?? '')).toEqual(flattenTexts(sample));
  });

  it('makes exactly ONE call per document, not one per block', async () => {
    const provider = stubProvider(JSON.stringify(flattenTexts(sample)));
    await runLlmCleanupPass(sample, provider);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('never sends structure — the payload is strings only', async () => {
    const provider = stubProvider(JSON.stringify(flattenTexts(sample)));
    await runLlmCleanupPass(sample, provider);
    const payload = JSON.parse(provider.calls[0]?.user ?? '') as unknown;
    expect(Array.isArray(payload)).toBe(true);
    for (const element of payload as unknown[]) expect(typeof element).toBe('string');
    // No structural key can appear in the payload at all.
    for (const key of ['type', 'page', 'level', 'ordered', 'rows', 'items', 'bbox']) {
      expect(provider.calls[0]?.user).not.toContain(key);
    }
  });

  it('passes maxOutputTokens through only when set', async () => {
    const withoutCap = stubProvider(JSON.stringify(flattenTexts(sample)));
    await runLlmCleanupPass(sample, withoutCap);
    expect(withoutCap.calls[0]).not.toHaveProperty('maxOutputTokens');

    const withCap = stubProvider(JSON.stringify(flattenTexts(sample)));
    await runLlmCleanupPass(sample, withCap, { maxOutputTokens: 512 });
    expect(withCap.calls[0]?.maxOutputTokens).toBe(512);
  });

  it('skips the call entirely for a document with no text values', async () => {
    const provider = stubProvider('[]');
    const result = await runLlmCleanupPass(doc([]), provider);
    expect(result).toEqual({ ok: true, texts: [] });
    expect(provider.complete).not.toHaveBeenCalled();
  });
});

describe('runLlmCleanupPass — reply handling (AC1, AC3)', () => {
  const one = doc([{ type: 'paragraph', text: 'a', page: 1 }]);

  it('accepts a well-formed reply', async () => {
    const result = await runLlmCleanupPass(one, stubProvider('["a"]'));
    expect(result).toEqual({ ok: true, texts: ['a'] });
  });

  it('tolerates a fenced code block wrapper', async () => {
    for (const reply of ['```json\n["a"]\n```', '```\n["a"]\n```', '  ```json\n["a"]```  ']) {
      const result = await runLlmCleanupPass(one, stubProvider(reply));
      expect(result).toEqual({ ok: true, texts: ['a'] });
    }
  });

  it('surfaces a provider error as a typed failure', async () => {
    const provider = stubProvider((): never => {
      throw new Error('HTTP 429');
    });
    const result = await runLlmCleanupPass(one, provider);
    expect(result).toMatchObject({ ok: false, failure: 'provider-error' });
    if (!result.ok) expect(result.detail).toMatch(/429/);
  });

  it('surfaces an unparseable reply', async () => {
    const result = await runLlmCleanupPass(one, stubProvider('Sure! Here you go:'));
    expect(result).toMatchObject({ ok: false, failure: 'unparseable-reply' });
  });

  it('surfaces a non-array reply', async () => {
    for (const reply of ['{"texts":["a"]}', '"a"', '42', 'null']) {
      const result = await runLlmCleanupPass(one, stubProvider(reply));
      expect(result).toMatchObject({ ok: false, failure: 'reply-not-an-array' });
    }
  });

  it('surfaces a wrong-length reply (a truncated or merged answer)', async () => {
    const result = await runLlmCleanupPass(sample, stubProvider('["Titre","Corps."]'));
    expect(result).toMatchObject({ ok: false, failure: 'reply-length-mismatch' });
    if (!result.ok) expect(result.detail).toMatch(/expected 8 elements, received 2/);
  });

  it('surfaces a non-string element', async () => {
    const result = await runLlmCleanupPass(one, stubProvider('[42]'));
    expect(result).toMatchObject({ ok: false, failure: 'reply-element-not-a-string' });
  });
});

describe('NETTOYAGE_SYSTEM_PROMPT — bounds the task (AC1)', () => {
  it('forbids every form of rewriting, in the instruction itself', () => {
    for (const forbidden of [
      'rewrite',
      'rephrase',
      'reformulate',
      'translate',
      'summarize',
      'reorder',
      'invent',
    ]) {
      expect(NETTOYAGE_SYSTEM_PROMPT.toLowerCase()).toContain(forbidden);
    }
  });

  it('requires the same element count and order', () => {
    expect(NETTOYAGE_SYSTEM_PROMPT).toMatch(/same number of elements/i);
    expect(NETTOYAGE_SYSTEM_PROMPT).toMatch(/same order/i);
  });

  it('names the decimal point, hyphen and comma as content', () => {
    expect(NETTOYAGE_SYSTEM_PROMPT).toMatch(/decimal point/i);
    expect(NETTOYAGE_SYSTEM_PROMPT).toMatch(/hyphen/i);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createDocument, type Block, type DocumentModel } from '../document-model';
import { flattenTexts } from './document-texts';
import type { LlmCompletionRequest, LlmProvider } from './llm-port';
import { cleanDocument, ruleOnlyResult } from './nettoyage';

/** Build a character from a code point — keeps this source pure ASCII. */
const ch = (codePoint: number): string => String.fromCodePoint(codePoint);
const BOX_H = ch(0x2500);
const ZWSP = ch(0x200b);
const NBSP = ch(0xa0);

const doc = (blocks: Block[]): DocumentModel =>
  createDocument({ type: 'pdf', pages: 1, provider: 'test' }, blocks);

/** A document carrying stage-1 artifacts AND stage-2 noise. */
const noisy = doc([
  { type: 'heading', level: 1, text: `${ZWSP}Rapport${BOX_H.repeat(4)}`, page: 1 },
  { type: 'paragraph', text: `Total${NBSP}${NBSP}: 12,50`, page: 1 },
  { type: 'list', ordered: false, items: [`${BOX_H} un`, 'deux'], page: 1 },
]);

/** A provider that replies with whatever `respond` derives from the sent texts. */
function provider(respond: (texts: string[]) => string): LlmProvider {
  return {
    name: 'stub',
    complete: vi.fn(async (request: LlmCompletionRequest) =>
      respond(JSON.parse(request.user) as string[]),
    ),
  };
}

const echo = provider((texts) => JSON.stringify(texts));
const deleteNoise = provider((texts) =>
  JSON.stringify(texts.map((t) => t.replaceAll(BOX_H, '').replace(/\s+/g, ' ').trim())),
);

describe('ruleOnlyResult — the Nettoyage-disabled / fallback path (AC3)', () => {
  it('applies stage 1 only and reports rule-only', () => {
    const result = ruleOnlyResult(noisy);
    expect(result.outcome).toBe('rule-only');
    expect(result.rejection).toBeUndefined();
    expect(result.failure).toBeUndefined();
    // Stage 1 ran: the ZWSP and the double NBSP are gone.
    expect(flattenTexts(result.document)[0]).toBe(`Rapport${BOX_H.repeat(4)}`);
    expect(flattenTexts(result.document)[1]).toBe('Total : 12,50');
  });
});

describe('cleanDocument — accepted cleanup (AC1, AC2)', () => {
  it('returns outcome "cleaned" and the cleaned document when the verifier accepts', async () => {
    const result = await cleanDocument(noisy, deleteNoise);
    expect(result.outcome).toBe('cleaned');
    expect(result.rejection).toBeUndefined();
    expect(result.failure).toBeUndefined();
    expect(flattenTexts(result.document)).toEqual(['Rapport', 'Total : 12,50', 'un', 'deux']);
  });

  it('accepts a no-op reply (an unchanged element is always acceptable)', async () => {
    const result = await cleanDocument(noisy, echo);
    expect(result.outcome).toBe('cleaned');
    // Equal to the rule-only output, since the model changed nothing.
    expect(flattenTexts(result.document)).toEqual(flattenTexts(ruleOnlyResult(noisy).document));
  });

  it('preserves structure exactly through a successful clean', async () => {
    const result = await cleanDocument(noisy, deleteNoise);
    expect(result.document.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list']);
    expect(result.document.blocks.map((b) => b.page)).toEqual([1, 1, 1]);
    expect(result.document.blocks[0]).toMatchObject({ level: 1 });
    const list = result.document.blocks[2];
    if (list?.type === 'list') {
      expect(list.ordered).toBe(false);
      expect(list.items).toHaveLength(2);
    }
    expect(result.document.source).toEqual(noisy.source);
  });
});

describe('cleanDocument — every failure path falls back to rule-only (AC3)', () => {
  const ruleOnlyTexts = flattenTexts(ruleOnlyResult(noisy).document);

  it('falls back when the verifier rejects a rewrite', async () => {
    const rewriter = provider((texts) => JSON.stringify(texts.map(() => 'Totalement reecrit')));
    const result = await cleanDocument(noisy, rewriter);
    expect(result.outcome).toBe('rule-only');
    expect(result.rejection?.reason).toBe('protected-content-removed');
    expect(flattenTexts(result.document)).toEqual(ruleOnlyTexts);
  });

  it('falls back when the model deletes protected content', async () => {
    const overEager = provider((texts) =>
      JSON.stringify(texts.map((t) => t.replace('12,50', '1250'))),
    );
    const result = await cleanDocument(noisy, overEager);
    expect(result.outcome).toBe('rule-only');
    expect(result.rejection?.reason).toBe('protected-content-removed');
    expect(flattenTexts(result.document)).toEqual(ruleOnlyTexts);
  });

  it('falls back when the model adds content', async () => {
    const adder = provider((texts) => JSON.stringify(texts.map((t) => `${t} (verifie)`)));
    const result = await cleanDocument(noisy, adder);
    expect(result.outcome).toBe('rule-only');
    expect(result.rejection?.reason).toBe('protected-content-removed');
    expect(flattenTexts(result.document)).toEqual(ruleOnlyTexts);
  });

  it('falls back when the provider throws', async () => {
    const broken: LlmProvider = {
      name: 'stub',
      complete: vi.fn(async () => {
        throw new Error('No Mistral API key configured. Set MISTRAL_API_KEY.');
      }),
    };
    const result = await cleanDocument(noisy, broken);
    expect(result.outcome).toBe('rule-only');
    expect(result.failure?.reason).toBe('provider-error');
    expect(result.failure?.detail).toMatch(/MISTRAL_API_KEY/);
    expect(result.rejection).toBeUndefined();
    expect(flattenTexts(result.document)).toEqual(ruleOnlyTexts);
  });

  it('falls back on a wrong-length reply (truncated or merged)', async () => {
    const truncating = provider((texts) => JSON.stringify(texts.slice(0, 2)));
    const result = await cleanDocument(noisy, truncating);
    expect(result.outcome).toBe('rule-only');
    expect(result.failure?.reason).toBe('reply-length-mismatch');
    expect(flattenTexts(result.document)).toEqual(ruleOnlyTexts);
  });

  it('falls back on a malformed reply', async () => {
    const chatty = provider(() => 'Of course! I cleaned it for you.');
    const result = await cleanDocument(noisy, chatty);
    expect(result.outcome).toBe('rule-only');
    expect(result.failure?.reason).toBe('unparseable-reply');
    expect(flattenTexts(result.document)).toEqual(ruleOnlyTexts);
  });

  it('never applies a cleanup partially — one bad element rejects the whole document', async () => {
    // Element 0 is cleaned legitimately; element 1 is rewritten. All or nothing.
    const mixed = provider((texts) =>
      JSON.stringify(texts.map((t, i) => (i === 1 ? 'Rewritten' : t.replaceAll(BOX_H, '').trim()))),
    );
    const result = await cleanDocument(noisy, mixed);
    expect(result.outcome).toBe('rule-only');
    expect(flattenTexts(result.document)).toEqual(ruleOnlyTexts);
    // The legitimately-cleaned element 0 did NOT survive.
    expect(flattenTexts(result.document)[0]).toBe(`Rapport${BOX_H.repeat(4)}`);
  });
});

describe('cleanDocument — invariants (AC2, AC3)', () => {
  it('always returns a document that is at least rule-clean', async () => {
    const providers = [
      echo,
      deleteNoise,
      provider(() => 'garbage'),
      provider((texts) => JSON.stringify(texts.map(() => 'Rewritten'))),
    ];
    for (const p of providers) {
      const result = await cleanDocument(noisy, p);
      for (const text of flattenTexts(result.document)) {
        expect(text).not.toContain(ZWSP);
        expect(text).not.toContain(NBSP);
        expect(text).toBe(text.trim());
      }
    }
  });

  it('does not mutate the input document', async () => {
    const before = structuredClone(noisy);
    await cleanDocument(noisy, deleteNoise);
    expect(noisy).toEqual(before);
  });

  it('never lets an exception escape — Nettoyage must not break a conversion', async () => {
    // A provider that violates its own contract by returning a non-string.
    const rogue = { name: 'stub', complete: async () => 42 as unknown as string } as LlmProvider;
    const result = await cleanDocument(noisy, rogue);
    expect(result.outcome).toBe('rule-only');
    expect(flattenTexts(result.document)).toEqual(flattenTexts(ruleOnlyResult(noisy).document));
  });

  it('handles an empty document without calling the provider', async () => {
    const never: LlmProvider = {
      name: 'stub',
      complete: vi.fn(async () => {
        throw new Error('should not be called');
      }),
    };
    const result = await cleanDocument(doc([]), never);
    expect(result.outcome).toBe('cleaned');
    expect(result.document.blocks).toEqual([]);
    expect(never.complete).not.toHaveBeenCalled();
  });
});

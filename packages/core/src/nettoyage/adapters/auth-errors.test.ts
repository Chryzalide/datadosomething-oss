import { describe, expect, it, vi } from 'vitest';
import { LlmConfigError } from '../llm-port';
import { cleanDocument } from '../nettoyage';
import { createDocument } from '../../document-model';
import { MistralSmallAdapter } from './mistral-small-adapter';

/**
 * Story 4.2 AC1 for the Nettoyage LLM: a rejected key names the variable. But
 * AD-8 still holds — a Nettoyage config problem must NOT fail a conversion, so
 * `cleanDocument` keeps degrading to rule-only. This file pins both halves.
 */

const request = { system: 's', user: 'u' };
const status = (code: number) => vi.fn(async () => new Response('nope', { status: code }));

describe('MistralSmallAdapter — rejected credential (AC1)', () => {
  it.each([401, 403])('throws LlmConfigError naming MISTRAL_API_KEY on %i', async (code) => {
    const adapter = new MistralSmallAdapter({ apiKey: 'bad', fetch: status(code) });
    await expect(adapter.complete(request)).rejects.toThrow(LlmConfigError);
    await expect(adapter.complete(request)).rejects.toThrow(/MISTRAL_API_KEY/);
  });

  it('leaves other failures generic', async () => {
    const adapter = new MistralSmallAdapter({ apiKey: 'k', fetch: status(500) });
    await expect(adapter.complete(request)).rejects.toThrow(/HTTP 500/);
    await expect(adapter.complete(request)).rejects.not.toThrow(LlmConfigError);
  });
});

describe('a rejected Nettoyage key still does not fail the conversion (AD-8)', () => {
  it('degrades to rule-only and reports why', async () => {
    const doc = createDocument({ type: 'pdf', pages: 1, provider: 'test' }, [
      { type: 'paragraph', text: 'Total | : 12,50', page: 1 },
    ]);
    const adapter = new MistralSmallAdapter({ apiKey: 'bad', fetch: status(401) });
    const result = await cleanDocument(doc, adapter);
    expect(result.outcome).toBe('rule-only');
    expect(result.failure?.reason).toBe('provider-error');
    expect(result.failure?.detail).toMatch(/MISTRAL_API_KEY/);
    // The document survived intact — cleaning failed, converting did not.
    expect(result.document.blocks).toHaveLength(1);
  });
});

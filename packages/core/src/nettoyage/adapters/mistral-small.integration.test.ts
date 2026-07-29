import { describe, expect, it } from 'vitest';
import { MistralSmallAdapter } from './mistral-small-adapter';
import { integrationApiKey, integrationSkipReason } from '../../__testing__/integration-gate';

/**
 * Gated real-API integration test: it hits the live Mistral chat-completions
 * API, so it runs only under an explicit opt-in (see `integration-gate.ts`).
 *
 * Its reason to exist beyond smoke coverage: `reasoning_effort` is an
 * architecture mandate (AR-2 / AD-8), not an API discovery. This test is the
 * bind-time check that the live endpoint accepts the field for a
 * `mistral-small-*` model rather than rejecting the request.
 */

const apiKey = integrationApiKey('MISTRAL_API_KEY');

// The reason is in the suite NAME so a skipped run says why it skipped —
// silence is what made a placeholder key look like broken code.
describe(`MistralSmallAdapter — real Mistral chat API (gated) [${integrationSkipReason('MISTRAL_API_KEY')}]`, () => {
  it.skipIf(!apiKey)(
    'accepts a temperature=0 / reasoning_effort="none" completion and returns text',
    async () => {
      const adapter = new MistralSmallAdapter({ apiKey: apiKey ?? '' });
      const reply = await adapter.complete({
        system: 'Reply with exactly the single word OK. No punctuation, no explanation.',
        user: 'ping',
        maxOutputTokens: 16,
      });
      expect(typeof reply).toBe('string');
      expect(reply.trim().length).toBeGreaterThan(0);
    },
    60_000,
  );
});

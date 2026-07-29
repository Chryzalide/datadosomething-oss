/**
 * Mistral Small adapter (AD-2) — the default Nettoyage LLM (AR-2). Calls the
 * Mistral chat-completions HTTP API via `fetch` (NO `@mistralai` SDK, so the
 * AD-1 boundary gate stays green) and returns the model's raw reply text; the
 * caller (stage 2, Story 3.2) owns the prompt and the verification of what comes
 * back — this adapter adds no interpretation.
 *
 * Mistral chat: POST https://api.mistral.ai/v1/chat/completions with JSON
 *   { model, temperature, reasoning_effort, messages: [system, user], max_tokens? }
 *   Authorization: Bearer <key>, Accept: application/json
 *   → { choices: [{ message: { content } }] }.
 * Keys are injected (BYO-keys); `core` never reads process.env.
 *
 * `temperature` and `reasoning_effort` come from the PORT constants and are
 * deliberately absent from `MistralSmallConfig`: AD-8's non-alteration guarantee
 * must not be configurable away.
 */
import {
  type LlmCompletionRequest,
  LlmConfigError,
  type LlmProvider,
  NETTOYAGE_REASONING_EFFORT,
  NETTOYAGE_TEMPERATURE,
} from '../llm-port';

export interface MistralSmallConfig {
  apiKey: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Override the endpoint (tests / self-host mirrors). */
  baseUrl?: string;
  /** Chat model id (a dated alias may be pinned at bind). */
  model?: string;
  /** Request timeout in ms (default 60s) — bounds a hung completion. */
  timeoutMs?: number;
}

interface MistralChatEnvelope {
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class MistralSmallAdapter implements LlmProvider {
  readonly name = 'mistral-small';
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: MistralSmallConfig) {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new LlmConfigError('No Mistral API key configured. Set MISTRAL_API_KEY.');
    }
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = config.baseUrl ?? 'https://api.mistral.ai/v1/chat/completions';
    this.model = config.model ?? 'mistral-small-latest';
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: NETTOYAGE_TEMPERATURE,
      reasoning_effort: NETTOYAGE_REASONING_EFFORT,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    };
    // Only send the cap when the caller set one — an absent field lets the
    // provider apply its own default rather than a value we invented.
    if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens;

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const reason =
        cause instanceof Error && cause.name === 'TimeoutError'
          ? `timed out after ${this.timeoutMs}ms`
          : `network error (${cause instanceof Error ? cause.message : String(cause)})`;
      throw new Error(`Mistral Small request failed — ${reason}.`, { cause });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // A refused credential names the variable too. This still does NOT fail a
      // conversion: `cleanDocument` degrades to rule-only (AD-8). It only makes
      // the reason legible to an operator reading logs.
      if (response.status === 401 || response.status === 403) {
        throw new LlmConfigError(
          `Mistral rejected the API key (HTTP ${response.status}). Check MISTRAL_API_KEY.`,
        );
      }
      throw new Error(`Mistral Small request failed (HTTP ${response.status}). ${detail}`.trim());
    }

    let payload: MistralChatEnvelope;
    try {
      payload = (await response.json()) as MistralChatEnvelope;
    } catch (cause) {
      throw new Error('Mistral Small returned a non-JSON response.', { cause });
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error(
        'Mistral Small returned an unexpected response (missing choices[0].message.content).',
      );
    }
    return content;
  }
}

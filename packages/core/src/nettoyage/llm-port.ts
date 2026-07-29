/**
 * The LLM provider port (AD-2) — the vendor-neutral boundary the Nettoyage LLM
 * pass (stage 2, Story 3.2) talks to. `core` depends only on this interface;
 * concrete adapters (MistralSmallAdapter, and the EU fallbacks OVH / Scaleway /
 * LightOn behind the same port) carry the vendor name. No provider name appears
 * in these identifiers, and nothing here reads `process.env` — keys are injected
 * by the app (BYO-keys, AD-1/AD-2).
 *
 * The determinism settings live HERE, on the port, rather than on any adapter:
 * AD-8 makes non-alteration a property of Nettoyage as a whole, so every present
 * and future adapter is bound by the same guarantee and no caller can dial it
 * away through config.
 */

/** Sampling temperature for every Nettoyage call (AR-2, AD-8). Not configurable. */
export const NETTOYAGE_TEMPERATURE = 0 as const;

/** Reasoning budget for every Nettoyage call (AR-2, AD-8). Not configurable.
 *  Nettoyage is a bounded character-level cleanup, never a reasoning task. */
export const NETTOYAGE_REASONING_EFFORT = 'none' as const;

/** One bounded completion request. `system` bounds the task, `user` carries the
 *  text to clean; there is no multi-turn history — Nettoyage is stateless. */
export interface LlmCompletionRequest {
  /** The bounding instruction (what the model may and may not do). */
  system: string;
  /** The payload the instruction applies to. */
  user: string;
  /** Optional hard cap on generated tokens — bounds cost and runaway output. */
  maxOutputTokens?: number;
}

/** A provider adapter: turns a bounded request into the model's raw text reply. */
export interface LlmProvider {
  /** Stable provider identity (a runtime value, e.g. "mistral-small"). */
  readonly name: string;
  complete(request: LlmCompletionRequest): Promise<string>;
}

/** A required LLM provider key/config is missing or invalid (FR-14, UX-DR10).
 *  Twin of `EngineConfigError`; its message names the env var to set. */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

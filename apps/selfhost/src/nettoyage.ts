import {
  cleanDocument,
  type DocumentModel,
  type LlmPassFailure,
  type LlmProvider,
  MistralSmallAdapter,
  type NettoyageOutcome,
  type NettoyageRejectionReason,
} from '@datadosomething/core';
import { selfhostNettoyageEnabled } from './nettoyage-config';

/**
 * Nettoyage composition for the self-hosted envelope (FR-18 self-host).
 *
 * The mirror image of `apps/hub/lib/nettoyage.ts`: same shape, opposite default.
 * Self-host is **on** unless told otherwise (`selfhostNettoyageEnabled`, Story
 * 3.3) because the operator runs the instance with their own keys and pays their
 * own LLM calls — there is nothing to gate.
 */

export interface NettoyageReport {
  outcome: NettoyageOutcome;
  reason?: NettoyageRejectionReason | LlmPassFailure;
}

export interface NettoyageComposition {
  enabled: boolean;
  /** Present only when a key is configured. Enabled with no provider means
   *  Nettoyage cannot run — the conversion still succeeds and serves raw. */
  provider?: LlmProvider;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveChatEndpoint(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === '' || parsed.pathname === '/') {
      return `${trimmed}/v1/chat/completions`;
    }
  } catch {
    // Pass through non-URL strings unchanged.
  }
  return trimmed;
}

export function composeNettoyage(
  env: Record<string, string | undefined> = process.env,
  enabledOverride?: boolean,
): NettoyageComposition {
  const enabled = enabledOverride ?? selfhostNettoyageEnabled(env);
  if (!enabled) return { enabled: false };

  const apiKey = env.NETTOYAGE_API_KEY?.trim() || env.MISTRAL_API_KEY?.trim();
  if (!apiKey) return { enabled: true };

  const baseUrl = resolveChatEndpoint(env.NETTOYAGE_BASE_URL);
  const model = env.NETTOYAGE_MODEL?.trim();
  const timeoutMs = parsePositiveInt(env.NETTOYAGE_TIMEOUT_MS);

  return {
    enabled: true,
    provider: new MistralSmallAdapter({
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    }),
  };
}

/**
 * Run Nettoyage over the canonical Document Model, between extraction and
 * rendering (AD-3), so both tools are cleaned by identical code on the identical
 * pivot.
 *
 * Off (or on with no key) → the **untouched** model and no report. Off means
 * genuinely raw, not rule-only: Story 3.3 settled that stage 1 is part of the
 * Nettoyage value, so running it while reporting nothing would misdescribe the
 * output.
 *
 * Never throws: Nettoyage must not be the reason a conversion fails (AD-8).
 */
export async function applyNettoyage(
  doc: DocumentModel,
  env: Record<string, string | undefined> = process.env,
  options: { enabled?: boolean } = {},
): Promise<{ document: DocumentModel; report?: NettoyageReport }> {
  try {
    const { enabled, provider } = composeNettoyage(env, options.enabled);
    if (!enabled || !provider) return { document: doc };

    const result = await cleanDocument(doc, provider);
    return {
      document: result.document,
      report: {
        outcome: result.outcome,
        ...(result.rejection ? { reason: result.rejection.reason } : {}),
        ...(result.failure ? { reason: result.failure.reason } : {}),
      },
    };
  } catch {
    // Degrade to raw rather than turn a successful conversion into an error.
    return { document: doc };
  }
}

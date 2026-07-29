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

export function composeNettoyage(
  env: Record<string, string | undefined> = process.env,
): NettoyageComposition {
  if (!selfhostNettoyageEnabled(env)) return { enabled: false };

  const mistralKey = env.MISTRAL_API_KEY?.trim();
  if (!mistralKey) return { enabled: true };

  return { enabled: true, provider: new MistralSmallAdapter({ apiKey: mistralKey }) };
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
): Promise<{ document: DocumentModel; report?: NettoyageReport }> {
  try {
    const { enabled, provider } = composeNettoyage(env);
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

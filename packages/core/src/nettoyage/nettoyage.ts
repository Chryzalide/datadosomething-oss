/**
 * Verified Nettoyage — the 3-stage pipeline (AD-8 / AR-9 / FR-18).
 *
 *   stage 1  deterministic rule pass      (Story 3.1, always runs)
 *   stage 2  bounded LLM pass             (this story)
 *   stage 3  deterministic verifier       (this story)
 *
 * The contract this module exists to keep: **what comes back is either cleaned
 * AND verified, or rule-only.** There is no third state and no partial
 * application — accepting some text values while rejecting others would let the
 * model's judgement leak into the output, which is exactly what AD-8 forbids.
 *
 * Every failure path lands on the same rule-only fallback: verifier rejection,
 * provider error, malformed reply, wrong-length reply. Each carries a structured
 * reason so the caller can render an honest notice.
 *
 * `core` ships NO user-facing prose here — only the machine-readable outcome.
 * The hub localizes it (AR-14). The Story 1.8 review already logged the verbatim
 * English config strings in `core` as latent i18n debt; this does not add more.
 */
import type { DocumentModel } from '../document-model';
import { flattenTexts, withTexts } from './document-texts';
import type { LlmProvider } from './llm-port';
import { type LlmPassFailure, type LlmPassOptions, runLlmCleanupPass } from './llm-pass';
import { ruleCleanDocument } from './rule-pass';
import {
  type NettoyageRejectionReason,
  type NettoyageSlotRejection,
  reconcileCleanedTexts,
  verifyCleanedDocument,
} from './verifier';

/** What actually ran. `'cleaned'` means stage 2 ran AND stage 3 accepted it. */
export type NettoyageOutcome = 'cleaned' | 'rule-only';

export interface NettoyageResult {
  /** The document to serve. Always at least rule-clean (stage 1). */
  document: DocumentModel;
  outcome: NettoyageOutcome;
  /**
   * Set when the verifier rejected one or more candidate text values.
   * When all noisy slots were rejected, `outcome` is `'rule-only'`; when only a
   * subset was rejected, accepted slots stay cleaned (`outcome: 'cleaned'`) and
   * rejected slots fall back to `ruleCleanText(raw)` with details exposed here.
   */
  rejection?: {
    reason: NettoyageRejectionReason;
    detail: string;
    rejectedIndices?: number[];
    slots?: NettoyageSlotRejection[];
  };
  /** Set iff stage 2 produced no usable candidate — `outcome` is `'rule-only'`. */
  failure?: { reason: LlmPassFailure; detail: string };
}

/**
 * The rule-only result: stage 1 alone, no LLM involved. This is the deterministic
 * byte-parity path (AD-14) and the Nettoyage-disabled path Story 3.3 needs.
 */
export function ruleOnlyResult(doc: DocumentModel): NettoyageResult {
  return { document: ruleCleanDocument(doc), outcome: 'rule-only' };
}

/**
 * Run the full pipeline. Stage 1 always applies; stages 2–3 only refine it, and
 * can only ever fall back to stage 1's output — never below it.
 */
export async function cleanDocument(
  doc: DocumentModel,
  provider: LlmProvider,
  options: LlmPassOptions = {},
): Promise<NettoyageResult> {
  // Stage 1. Everything downstream compares against THIS, not the untouched
  // input: stage 1's guarantee (Story 3.1) is that it preserves all visible
  // characters, so verifying against it is equivalent to verifying against the
  // raw text, and it keeps whitespace normalization out of every comparison.
  const ruleOnly = ruleCleanDocument(doc);

  // Stages 2-3 are wrapped so that NOTHING they can throw escapes: Nettoyage is
  // a refinement, and it must never be the stage that breaks a conversion (AD-8
  // — on failure, serve raw). `runLlmCleanupPass` already returns typed failures
  // rather than throwing, so this is belt-and-braces against a future edit or an
  // exotic provider implementation.
  try {
    // Stage 2.
    const pass = await runLlmCleanupPass(ruleOnly, provider, options);
    if (!pass.ok) {
      return {
        document: ruleOnly,
        outcome: 'rule-only',
        failure: { reason: pass.failure, detail: pass.detail },
      };
    }

    if (pass.skipped) {
      return { document: ruleOnly, outcome: 'cleaned' };
    }

    // Stage 3: granular per-string verification and reconciliation.
    const rawTexts = flattenTexts(ruleOnly);
    const reconciled = reconcileCleanedTexts(rawTexts, pass.texts);

    // If every noisy slot was rejected, the entire candidate falls back to rule-only.
    if (reconciled.rejections.length > 0 && reconciled.acceptedNoisyCount === 0) {
      const first = reconciled.rejections[0]!;
      return {
        document: ruleOnly,
        outcome: 'rule-only',
        rejection: {
          reason: first.reason,
          detail: first.detail,
          rejectedIndices: reconciled.rejections.map((r) => r.index),
          slots: reconciled.rejections,
        },
      };
    }

    // Rebuild the document around the SAME structure using the reconciled texts
    // (accepted candidates + rule-clean raw fallback for any rejected slot).
    const candidate = ruleCleanDocument(withTexts(ruleOnly, reconciled.texts));

    // Independent structural + full-document audit (belt-and-braces).
    const verdict = verifyCleanedDocument(ruleOnly, candidate);
    if (!verdict.accepted) {
      return {
        document: ruleOnly,
        outcome: 'rule-only',
        rejection: { reason: verdict.reason, detail: verdict.detail },
      };
    }

    if (reconciled.rejections.length > 0) {
      const first = reconciled.rejections[0]!;
      return {
        document: candidate,
        outcome: 'cleaned',
        rejection: {
          reason: first.reason,
          detail: first.detail,
          rejectedIndices: reconciled.rejections.map((r) => r.index),
          slots: reconciled.rejections,
        },
      };
    }

    return { document: candidate, outcome: 'cleaned' };
  } catch (cause) {
    return {
      document: ruleOnly,
      outcome: 'rule-only',
      failure: {
        reason: 'provider-error',
        detail: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}

/**
 * Nettoyage stage 2 — the bounded LLM pass (AD-8 / AR-9).
 *
 * Sends the document's in-block text values through the `LlmProvider` port
 * (Story 3.1) at `temperature=0` / `reasoning_effort="none"`, with a bounding
 * instruction that permits deletion of OCR frame noise only.
 *
 * Two structural properties, both deliberate:
 *
 *  - **Structure never reaches the model.** Only `flattenTexts` output is sent
 *    and only text values are substituted back, so block types, hierarchy,
 *    order, `page`, `level`, `ordered` and the table shape cannot be altered
 *    even in principle. This is what makes AD-8's immutability claim mechanical.
 *  - **One call per document**, not per block. A per-block loop would multiply
 *    the LLM cost of every conversion, which the cost <= revenue constraint does
 *    not allow.
 *
 * Nothing here trusts the reply: a malformed, wrong-length, or hostile answer is
 * returned as a typed failure, and the verifier (stage 3) audits whatever does
 * come back. This function never mutates the input document.
 */
import type { DocumentModel } from '../document-model';
import { flattenTexts, textCount } from './document-texts';
import type { LlmProvider } from './llm-port';
import { NETTOYAGE_REMOVABLE_NOISE } from './verifier';

/**
 * The bounding instruction. It enumerates what may be deleted and forbids every
 * form of rewriting; the verifier enforces the same boundary mechanically, so
 * this prompt is guidance, never the guarantee (SPEC: tuned on staging).
 */
export const NETTOYAGE_SYSTEM_PROMPT = [
  'You clean OCR noise out of extracted document text. You are not an editor.',
  '',
  'Input is a JSON array of strings. Return a JSON array of strings with EXACTLY',
  'the same number of elements, in the same order, and nothing else — no prose,',
  'no explanation, no code fence.',
  '',
  'For each element you may ONLY delete characters that are scanning or framing',
  'artifacts: box-drawing characters, block elements, geometric shapes, and the',
  'characters | ¦ ¬ `',
  '',
  'You must NOT:',
  '- add, invent, complete or annotate any text;',
  '- rewrite, rephrase, reformulate, correct, translate or summarize anything;',
  '- reorder characters, words, sentences or elements;',
  '- delete or substitute any letter, digit, accent, punctuation mark or currency',
  '  symbol — a decimal point, a hyphen and a comma are content, not noise;',
  '- merge, split, drop or add elements.',
  '',
  'If an element contains no such artifact, return it byte-for-byte unchanged.',
  'When in doubt, change nothing: an unchanged element is always acceptable.',
].join('\n');

/** Why stage 2 produced no usable candidate. */
export type LlmPassFailure =
  | 'provider-error'
  | 'unparseable-reply'
  | 'reply-not-an-array'
  | 'reply-element-not-a-string'
  | 'reply-length-mismatch';

/** Stage 2's outcome: the candidate text values, or a typed failure. */
export type LlmPassResult =
  | { ok: true; texts: string[]; skipped?: boolean }
  | { ok: false; failure: LlmPassFailure; detail: string };

export interface LlmPassOptions {
  /**
   * Hard cap on generated tokens, passed through to the provider. Left unset by
   * default on purpose: the adapter does not surface `finish_reason` (logged in
   * `deferred-work.md`), so a cap guessed here could silently truncate a reply.
   * A truncated reply still fails the length check or the verifier, but the
   * caller that owns the cost policy (Story 3.3 / Epic 5) should set this.
   */
  maxOutputTokens?: number;
}

const fail = (failure: LlmPassFailure, detail: string): LlmPassResult => ({
  ok: false,
  failure,
  detail,
});

/**
 * Strip a fenced code block if the model wrapped its answer in one. Models do
 * this often enough that rejecting it would waste a perfectly good reply, and
 * unwrapping cannot smuggle content past the verifier.
 */
function unfence(reply: string): string {
  const trimmed = reply.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '');
  return withoutOpen.replace(/\r?\n?```$/, '').trim();
}

/** Run stage 2 over a document's in-block text values. */
export async function runLlmCleanupPass(
  doc: DocumentModel,
  provider: LlmProvider,
  options: LlmPassOptions = {},
): Promise<LlmPassResult> {
  const expected = textCount(doc);
  // Nothing to clean — skip the call entirely rather than pay for an empty round
  // trip. `[]` is a legitimate accepted candidate.
  if (expected === 0) return { ok: true, texts: [], skipped: true };

  const texts = flattenTexts(doc);

  // Sparse LLM pass: only elements containing at least one character in
  // `NETTOYAGE_REMOVABLE_NOISE` can be modified by stage 2 without being
  // rejected by stage 3. Extract the noisy subset along with its original
  // indices, and short-circuit with zero network calls when none match.
  const noisyIndices: number[] = [];
  const noisyTexts: string[] = [];
  for (const [index, text] of texts.entries()) {
    if (NETTOYAGE_REMOVABLE_NOISE.test(text)) {
      noisyIndices.push(index);
      noisyTexts.push(text);
    }
  }

  if (noisyIndices.length === 0) {
    return { ok: true, texts, skipped: true };
  }

  let reply: string;
  try {
    reply = await provider.complete({
      system: NETTOYAGE_SYSTEM_PROMPT,
      user: JSON.stringify(noisyTexts),
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
    });
  } catch (cause) {
    return fail('provider-error', cause instanceof Error ? cause.message : String(cause));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(reply));
  } catch {
    return fail('unparseable-reply', 'the reply was not valid JSON');
  }

  if (!Array.isArray(parsed)) {
    return fail('reply-not-an-array', `expected a JSON array, received ${typeof parsed}`);
  }
  if (parsed.length !== noisyTexts.length) {
    return fail(
      'reply-length-mismatch',
      `expected ${noisyTexts.length} elements, received ${parsed.length}`,
    );
  }
  if (!parsed.every((element): element is string => typeof element === 'string')) {
    return fail('reply-element-not-a-string', 'at least one element was not a string');
  }

  const merged = [...texts];
  for (const [subsetIndex, docIndex] of noisyIndices.entries()) {
    merged[docIndex] = parsed[subsetIndex]!;
  }

  return { ok: true, texts: merged };
}

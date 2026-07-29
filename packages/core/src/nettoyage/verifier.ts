/**
 * Nettoyage stage 3 — the deterministic verifier (AD-8 / AR-9).
 *
 * This is the hard guarantee. Per SPEC, the Nettoyage prompt is tuned on staging
 * and "AD-8's deterministic verifier is the hard non-alteration guarantee
 * REGARDLESS OF PROMPT" — so nothing here trusts the model, and a rejection is
 * correct behavior, not a failure.
 *
 * Stage 1 already removed every character in its own two classes, so holding
 * stage 2 to "may only change stage-1 classes" would leave it nothing to do. The
 * allowed change for stage 2 is *visible* OCR noise ("caractères parasites",
 * FR-18), constrained by two mechanical checks per text value:
 *
 *   1. protectedProjection(candidate) === protectedProjection(raw)
 *      The projection deletes ONLY `NETTOYAGE_REMOVABLE_NOISE`. Byte-equality of
 *      the projections means every meaning-bearing character survives, in the
 *      same order, unsubstituted — which forbids added, removed, reordered and
 *      paraphrased content in a single comparison.
 *
 *   2. isSubsequence(candidate, raw)
 *      Forbids adding anything at all, including extra noise characters.
 *
 * Together: stage 2 may only DELETE, and only from an enumerated noise set. The
 * semantic guarantee rides on check 1 specifically so it never depends on which
 * embedding a subsequence match happens to pick.
 *
 * Both sides are `ruleCleanText`-normalized first, so a whitespace difference or
 * an artifact the model re-introduced can never decide a verdict.
 *
 * Pure and deterministic: no Date, no random, no network, no locale.
 */
import type { Block, DocumentModel } from '../document-model';
import { charClass, type CodePointRange } from './char-class';
import { flattenTexts } from './document-texts';
import { ruleCleanText } from './rule-pass';

/**
 * The ONLY characters stage 2 is permitted to delete: OCR frame and scan noise.
 *
 * Enumerated deliberately, rather than derived as "everything that is not a
 * letter or digit", so what may be deleted is auditable and cannot silently
 * widen. Letters, digits, combining marks, punctuation and currency are all
 * protected — notably `.` and `,` stay protected, so `12.50` can never become
 * `1250`, and `-` stays protected so a real hyphen survives.
 *
 * Widening this table is the staging tuning knob SPEC anticipates; doing so does
 * not weaken either check above.
 */
const REMOVABLE_NOISE_RANGES: readonly CodePointRange[] = [
  [0x0060, 0x0060], // grave accent — a stray OCR tick
  [0x007c, 0x007c], // vertical line — mis-read table border
  [0x00a6, 0x00a6], // broken bar
  [0x00ac, 0x00ac], // not sign
  [0x2500, 0x257f], // box drawing
  [0x2580, 0x259f], // block elements
  [0x25a0, 0x25ff], // geometric shapes
];

/** The removable-noise class. Non-global (a shared global `RegExp` carries
 *  `lastIndex`, which makes repeated `.test()` alternate). */
export const NETTOYAGE_REMOVABLE_NOISE = charClass(REMOVABLE_NOISE_RANGES, 'u');

/** Global variant, derived from the exported class's own source so the two
 *  cannot drift. */
const REMOVABLE_NOISE_G = new RegExp(NETTOYAGE_REMOVABLE_NOISE.source, 'gu');

/** Why a candidate was rejected. */
export type NettoyageRejectionReason =
  | 'structure-changed'
  | 'text-count-mismatch'
  | 'content-not-a-subsequence'
  | 'protected-content-removed';

/** The verifier's verdict. */
export type NettoyageVerdict =
  { accepted: true } | { accepted: false; reason: NettoyageRejectionReason; detail: string };

const ACCEPTED: NettoyageVerdict = { accepted: true };

const reject = (reason: NettoyageRejectionReason, detail: string): NettoyageVerdict => ({
  accepted: false,
  reason,
  detail,
});

/**
 * Everything in `value` that stage 2 may NOT delete, whitespace-normalized. Two
 * texts with equal projections carry exactly the same meaning-bearing
 * characters, in the same order, and with the same separations.
 *
 * Noise is replaced by a SPACE, not deleted, and that is the load-bearing
 * detail. Deleting it would let a noise character between two protected
 * characters vanish and silently join them: `"12|50"` would project to `"1250"`
 * and so would the candidate `"1250"`, making a mis-read table border turn two
 * numbers into a different one. Substituting a space keeps the separation
 * visible (`"12 50"` != `"1250"`), so such a join is caught.
 *
 * `ruleCleanText` then runs again to collapse the whitespace the substitution
 * introduces, so a genuine noise deletion still compares equal against a
 * candidate that also tidied the resulting gap (`"---- Total ----"` and
 * `"Total"` both project to `"Total"`).
 */
export function protectedProjection(value: string): string {
  return ruleCleanText(ruleCleanText(value).replace(REMOVABLE_NOISE_G, ' '));
}

/** Is `candidate` obtainable from `raw` by deletion alone? Greedy is correct for
 *  subsequence testing. */
function isSubsequence(candidate: string, raw: string): boolean {
  const c = [...candidate];
  const r = [...raw];
  let i = 0;
  for (const char of r) {
    if (i < c.length && c[i] === char) i += 1;
  }
  return i === c.length;
}

/** Verify one candidate text value against its raw counterpart (stage 3). */
export function verifyCleanedText(raw: string, candidate: string): NettoyageVerdict {
  const normalizedRaw = ruleCleanText(raw);
  const normalizedCandidate = ruleCleanText(candidate);

  // Check 1 — the semantic guarantee.
  if (protectedProjection(normalizedCandidate) !== protectedProjection(normalizedRaw)) {
    return reject(
      'protected-content-removed',
      "the candidate does not carry exactly the raw text's protected characters, in order",
    );
  }

  // Check 2 — nothing added.
  if (!isSubsequence(normalizedCandidate, normalizedRaw)) {
    return reject(
      'content-not-a-subsequence',
      'the candidate is not obtainable from the raw text by deletion alone',
    );
  }

  return ACCEPTED;
}

/** Structural fingerprint of a block: everything Nettoyage must leave alone. */
function structureOf(block: Block): string {
  switch (block.type) {
    case 'heading':
      return `heading:${block.level}:${block.page}`;
    case 'paragraph':
      return `paragraph:${block.page}`;
    case 'list':
      return `list:${block.ordered ? 'ordered' : 'unordered'}:${block.items.length}:${block.page}`;
    case 'table':
      return `table:[${block.rows.map((row) => row.length).join(',')}]:${block.page}`;
    default: {
      const exhaustive: never = block;
      void exhaustive;
      return 'unknown';
    }
  }
}

/**
 * Verify a candidate document against the raw one (stage 3): the structure must
 * be identical and every in-block text value must pass `verifyCleanedText`.
 *
 * Note the asymmetry with `withTexts`: that function makes structural change
 * impossible *by construction* for our own pipeline, while this check is the
 * independent audit — it holds even if a future caller assembles the candidate
 * some other way.
 */
export function verifyCleanedDocument(
  rawDoc: DocumentModel,
  candidateDoc: DocumentModel,
): NettoyageVerdict {
  if (rawDoc.blocks.length !== candidateDoc.blocks.length) {
    return reject(
      'structure-changed',
      `block count changed: ${rawDoc.blocks.length} → ${candidateDoc.blocks.length}`,
    );
  }

  for (const [index, rawBlock] of rawDoc.blocks.entries()) {
    const candidateBlock = candidateDoc.blocks[index];
    if (!candidateBlock) {
      return reject('structure-changed', `block ${index} is missing from the candidate`);
    }
    const rawStructure = structureOf(rawBlock);
    const candidateStructure = structureOf(candidateBlock);
    if (rawStructure !== candidateStructure) {
      return reject(
        'structure-changed',
        `block ${index} structure changed: ${rawStructure} → ${candidateStructure}`,
      );
    }
  }

  const rawTexts = flattenTexts(rawDoc);
  const candidateTexts = flattenTexts(candidateDoc);
  if (rawTexts.length !== candidateTexts.length) {
    // Unreachable while the structure check above passes (the counts are derived
    // from the same shape), kept as a belt-and-braces guard on the invariant.
    return reject(
      'text-count-mismatch',
      `text value count changed: ${rawTexts.length} → ${candidateTexts.length}`,
    );
  }

  for (const [index, rawText] of rawTexts.entries()) {
    const verdict = verifyCleanedText(rawText, candidateTexts[index] ?? '');
    if (!verdict.accepted) {
      return reject(verdict.reason, `text value ${index}: ${verdict.detail}`);
    }
  }

  return ACCEPTED;
}

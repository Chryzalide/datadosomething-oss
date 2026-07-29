/**
 * Shared helper for building the Nettoyage character classes from code-point
 * range tables (extracted from `rule-pass.ts` in Story 3.2 so stage 3's
 * removable-noise class is built the same way stage 1's classes are).
 *
 * Classes are assembled from the actual characters rather than written as
 * escapes, so the class definitions stay pure ASCII in source and the ranges
 * read as auditable data.
 */

/** An inclusive code-point range `[low, high]`. */
export type CodePointRange = readonly [number, number];

/** Code points that would be read as character-class syntax if a range ever
 *  contained one: `-` (range), `]` (close), `^` (negate), `\` (escape). */
const CLASS_SYNTAX = [0x002d, 0x005c, 0x005d, 0x005e];

/**
 * Build a character-class regex from code-point ranges.
 *
 * Throws if any range would pull in a character that is class syntax — the
 * classes are concatenated literally, so such a member would silently change
 * what the class means. Every class in this folder is built from hardcoded
 * tables, so this can only fire on a bad edit, and failing at module load is
 * far better than shipping a class that matches the wrong thing.
 */
export function charClass(ranges: readonly CodePointRange[], flags: string): RegExp {
  for (const codePoint of CLASS_SYNTAX) {
    if (ranges.some(([low, high]) => codePoint >= low && codePoint <= high)) {
      throw new Error(
        `Character class range table includes U+${codePoint
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')}, which is regex character-class syntax.`,
      );
    }
  }
  const body = ranges
    .map(([low, high]) =>
      low === high
        ? String.fromCodePoint(low)
        : `${String.fromCodePoint(low)}-${String.fromCodePoint(high)}`,
    )
    .join('');
  return new RegExp(`[${body}]`, flags);
}

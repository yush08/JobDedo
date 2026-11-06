/**
 * Targeted mojibake repair for previously saved records.
 *
 * Root cause: a handful of string literals in the Outreach client were
 * decoded as CP437/OEM text when they were written into the repo, baking
 * sequences like `ΓÇö` (UTF-8 bytes of `—` read as CP437) into the source.
 * Saved drafts that were created from those literals carry the same
 * sequences in the database.
 *
 * This helper repairs ONLY the exact corrupted substrings we identified —
 * it never blanket-replaces Unicode, so valid user text (curly quotes,
 * em dashes, arrows, CJK, emoji) passes through untouched. Apply it when
 * READING stored drafts; freshly generated content is already correct.
 */

/** Exact CP437-mojibake sequence → the character it should have been. */
const MOJIBAKE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ΓÇö", "—"], // em dash   (U+2014)
  ["ΓÇô", "–"], // en dash   (U+2013)
  ["ΓÇª", "…"], // ellipsis  (U+2026)
  ["ΓÇÖ", "’"], // right single quote (U+2019)
  ["ΓÇ£", "“"], // left double quote  (U+201C)
  ["ΓÇ¥", "”"], // right double quote (U+201D)
  ["ΓåÆ", "→"], // rightwards arrow   (U+2192)
  ["┬╖", "·"],  // middle dot         (U+00B7)
];

/**
 * Repair known CP437 mojibake sequences in `text`.
 *
 * - Unknown text is returned unchanged (idempotent, non-destructive).
 * - Only exact substrings from the known-corruption map are replaced.
 * - Safe to call on every read; calling twice yields the same result.
 */
export function repairKnownMojibake(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [corrupted, repaired] of MOJIBAKE_PAIRS) {
    if (out.includes(corrupted)) {
      out = out.split(corrupted).join(repaired);
    }
  }
  return out;
}

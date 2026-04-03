/**
 * Normalize free-text skills for storage and display: trim, collapse spaces,
 * title-case words (including hyphenated segments). No master dictionary.
 */
export function normalizeSkillLabel(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((part) => {
          if (!part) return "";
          return (
            part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
          );
        })
        .join("-")
    )
    .join(" ");
}

/** Deduplicate by case-insensitive key; each value is normalized. */
export function dedupeSkillsNormalized(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    const n = normalizeSkillLabel(s);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

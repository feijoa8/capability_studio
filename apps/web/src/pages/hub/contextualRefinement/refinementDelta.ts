/**
 * Lightweight comparison helpers for work-experience refinement review UI.
 * No backend dependency; normalization matches typical tag chip behavior (trim + case-insensitive keys).
 */

export function normalizeDescriptionWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function descriptionsEffectivelyEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (left === right) return true;
  return normalizeDescriptionWhitespace(left) === normalizeDescriptionWhitespace(right);
}

export type TagDelta = {
  added: string[];
  removed: string[];
  unchanged: string[];
};

function tagKey(s: string): string {
  return s.trim().toLowerCase();
}

export function compareTagArrays(
  current: string[] | null | undefined,
  suggested: string[] | null | undefined,
): TagDelta {
  const curRaw = (current ?? []).map((s) => s.trim()).filter(Boolean);
  const sugRaw = (suggested ?? []).map((s) => s.trim()).filter(Boolean);

  const curByKey = new Map<string, string>();
  for (const c of curRaw) {
    const k = tagKey(c);
    if (!curByKey.has(k)) curByKey.set(k, c);
  }
  const sugByKey = new Map<string, string>();
  for (const s of sugRaw) {
    const k = tagKey(s);
    if (!sugByKey.has(k)) sugByKey.set(k, s);
  }

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const [k, sVal] of sugByKey) {
    if (curByKey.has(k)) unchanged.push(sVal);
    else added.push(sVal);
  }
  for (const [k, cVal] of curByKey) {
    if (!sugByKey.has(k)) removed.push(cVal);
  }

  const sortCi = (x: string, y: string) =>
    x.localeCompare(y, undefined, { sensitivity: "base" });
  added.sort(sortCi);
  removed.sort(sortCi);
  unchanged.sort(sortCi);

  return { added, removed, unchanged };
}

export type IndustryDelta = {
  isEqual: boolean;
  currentDisplay: string;
  suggestedDisplay: string;
};

export function compareIndustry(
  current: string | null | undefined,
  suggested: string | null | undefined,
): IndustryDelta {
  const currentDisplay = (current ?? "").trim();
  const suggestedDisplay = (suggested ?? "").trim();
  const isEqual =
    currentDisplay === suggestedDisplay ||
    (currentDisplay.length > 0 &&
      suggestedDisplay.length > 0 &&
      currentDisplay.toLowerCase() === suggestedDisplay.toLowerCase());
  return { isEqual, currentDisplay, suggestedDisplay };
}

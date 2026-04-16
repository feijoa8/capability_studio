/**
 * Lightweight canonicalization, filtering, and ordering for evidence tag buckets
 * (skills, methods, tools) after CV extraction merge — before storage / UI aggregation.
 *
 * Goals: reduce noisy near-duplicates, strip mis-filed “tools”, drop a few low-value
 * granular-skill fluff terms, without a taxonomy graph or heavy scoring.
 */

import { dedupeSkillsNormalized, normalizeSkillLabel } from "./skillNormalization";

/** Same shape as {@link mergeExtractedEvidenceTags} output (kept local to avoid circular imports). */
export type PostProcessableEvidenceBuckets = {
  skills: string[];
  methods: string[];
  tools: string[];
};

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function wordCount(label: string): number {
  return label.trim().split(/\s+/).filter(Boolean).length;
}

/** Explicit alias → canonical display (per bucket). Do not merge distinct execution concepts. */
const SKILL_CANONICAL: Readonly<Record<string, string>> = {
  "customer experience development": "Customer Experience Design",
  "customer experience design management": "Customer Experience Design",
  "cx design": "Customer Experience Design",
  "journey mapping": "Customer Journey Mapping",
  "user journey mapping": "Customer Journey Mapping",
};

const METHOD_CANONICAL: Readonly<Record<string, string>> = {
  "scrum framework": "Scrum",
  "scrum methodology": "Scrum",
  "kanban methodology": "Kanban",
  "agile methodology": "Agile",
  "scaled agile framework": "SAFe",
};

const TOOL_CANONICAL: Readonly<Record<string, string>> = {
  azure: "Microsoft Azure",
  "ms azure": "Microsoft Azure",
  ado: "Azure DevOps",
  "azure dev ops": "Azure DevOps",
};

/** Drop as granular skill tags (low information or soft umbrella). */
const DROP_SKILL_KEYS = new Set<string>([
  "coaching",
  "mentoring",
  "cross functional leadership",
  "cross-functional leadership",
  "leadership",
  "communication",
  "teamwork",
  "collaboration",
  "stakeholder management",
  "results-driven",
  "results driven",
  "strategic thinker",
  "strategic thinking",
  "detail oriented",
  "detail-oriented",
]);

/** Looks like a prose collaboration / engagement phrase, not a product. */
const NOT_A_TOOL_LINE = /\bengagement\s+with\b|\bcollaboration\s+with\b|\bworking\s+with\b.*\bteams?\b|\bstakeholder\s+engagement\b/i;

function canonicalizeInMap(
  label: string,
  map: Readonly<Record<string, string>>,
): string {
  const n = normalizeSkillLabel(label);
  if (!n) return "";
  const k = normKey(n);
  const hit = map[k];
  return hit ? normalizeSkillLabel(hit) : n;
}

function shouldDropSkillKey(k: string): boolean {
  if (DROP_SKILL_KEYS.has(k)) return true;
  if (k.length <= 2) return true;
  return false;
}

/** Tools must look like named products/platforms, not sentences. */
function shouldDropOrRelocateTool(label: string):
  | { action: "keep"; label: string }
  | { action: "drop" }
  | { action: "toMethods"; label: string } {
  const n = normalizeSkillLabel(label);
  if (!n) return { action: "drop" };
  const k = normKey(n);
  const wc = wordCount(n);

  if (TOOL_CANONICAL[k]) {
    return { action: "keep", label: normalizeSkillLabel(TOOL_CANONICAL[k]) };
  }

  if (NOT_A_TOOL_LINE.test(n) || NOT_A_TOOL_LINE.test(k)) {
    return { action: "drop" };
  }
  if (wc >= 9) {
    return { action: "drop" };
  }
  if (wc >= 6 && /\b(and|with|for|across)\b/i.test(n)) {
    return { action: "drop" };
  }

  if (
    k === "agile" ||
    k === "scrum" ||
    k === "kanban" ||
    k === "waterfall" ||
    k === "lean"
  ) {
    return { action: "toMethods", label: n };
  }

  return { action: "keep", label: n };
}

function pushUnique(arr: string[], label: string): void {
  const n = normalizeSkillLabel(label);
  if (!n) return;
  const k = n.toLowerCase();
  if (arr.some((x) => x.toLowerCase() === k)) return;
  arr.push(n);
}

/**
 * Prefer higher-signal phrases in UI: more words first when counts tie (handled in aggregate),
 * here: longer phrases first within a row, then alphabetical.
 */
export function sortEvidenceTagsForPresentation(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => {
    const wc = wordCount(b) - wordCount(a);
    if (wc !== 0) return wc;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

/**
 * Merge canonical forms, filter noise, relocate obvious mis-files, dedupe, and order.
 */
export function postProcessEvidenceBuckets(
  input: PostProcessableEvidenceBuckets,
): PostProcessableEvidenceBuckets {
  const skills: string[] = [];
  const methods: string[] = [];
  const tools: string[] = [];

  for (const raw of input.skills ?? []) {
    const c = canonicalizeInMap(String(raw), SKILL_CANONICAL);
    if (!c) continue;
    const k = normKey(c);
    if (shouldDropSkillKey(k)) continue;
    pushUnique(skills, c);
  }

  for (const raw of input.methods ?? []) {
    const c = canonicalizeInMap(String(raw), METHOD_CANONICAL);
    if (!c) continue;
    pushUnique(methods, c);
  }

  for (const raw of input.tools ?? []) {
    const c0 = canonicalizeInMap(String(raw), TOOL_CANONICAL);
    const rel = shouldDropOrRelocateTool(c0);
    if (rel.action === "drop") continue;
    if (rel.action === "toMethods") {
      pushUnique(methods, rel.label);
      continue;
    }
    if (rel.action === "keep") {
      pushUnique(tools, rel.label);
    }
  }

  const toolKeySet = new Set(tools.map((t) => t.toLowerCase()));
  const methodKeySet = new Set(methods.map((m) => m.toLowerCase()));

  const skillsDeduped = skills.filter((s) => {
    const k = s.toLowerCase();
    if (toolKeySet.has(k) || methodKeySet.has(k)) return false;
    return true;
  });

  const methodsDeduped = methods.filter((m) => {
    const k = m.toLowerCase();
    if (toolKeySet.has(k)) return false;
    return true;
  });

  return {
    skills: sortEvidenceTagsForPresentation(dedupeSkillsNormalized(skillsDeduped)),
    methods: sortEvidenceTagsForPresentation(dedupeSkillsNormalized(methodsDeduped)),
    tools: sortEvidenceTagsForPresentation(dedupeSkillsNormalized(tools)),
  };
}

/**
 * Evidence-first tag enrichment for CV import and legacy `skills`-only payloads.
 *
 * Four analytical categories (V1 storage on evidence rows):
 * - **Skills** — specific, execution-level capabilities (workshop facilitation, requirements definition).
 * - **Methods / practices** — transferable ways of working (Scrum, Kanban, Design Thinking).
 * - **Tools / platforms** — named products/systems (Jira, Miro, Azure DevOps).
 * - **Industries / domains** — context only; stored as `industry` on the row, not classified here.
 *
 * Quality rules (see classifyTag):
 * - Broad role umbrellas (e.g. "Business Analysis") are not kept as *skills*; they route to
 *   *methods* when they denote a practice, or are dropped if too vague.
 * - Tools are detected before methods where a phrase matches a known product (e.g. Azure DevOps).
 *
 * Later AI can suggest tags per category; outputs should merge through {@link mergeExtractedEvidenceTags}
 * so provenance stays on the role/project row.
 */

import { dedupeSkillsNormalized, normalizeSkillLabel } from "./skillNormalization";
import { postProcessEvidenceBuckets } from "./evidenceTagPostProcess";

export type EvidenceTagBuckets = {
  skills: string[];
  methods: string[];
  tools: string[];
};

/** Lowercase keys for phrase matching (multi-word before single tokens where needed). */
const TOOL_PHRASES: readonly string[] = [
  "azure devops",
  "microsoft azure",
  "power bi",
  "google analytics",
  "miro",
  "figma",
  "jira",
  "confluence",
  "trello",
  "asana",
  "monday.com",
  "smartsheet",
  "notion",
  "slack",
  "microsoft teams",
  "zoom",
  "salesforce",
  "servicenow",
  "workday",
  "sap",
  "oracle",
  "github",
  "gitlab",
  "bitbucket",
  "tableau",
  "looker",
  "excel",
  "word",
  "powerpoint",
  "sharepoint",
  "teams",
  "ado",
];

const METHOD_PHRASES: readonly string[] = [
  "design thinking",
  "lean six sigma",
  "six sigma",
  "continuous integration",
  "continuous delivery",
  "extreme programming",
  "lean startup",
  "scaled agile",
  "safe agile",
  "agile coaching",
  "digital transformation",
  "scrum",
  "kanban",
  "lean",
  "agile",
  "waterfall",
  "prince2",
  "prince 2",
  "devops",
  "ci/cd",
  "okr",
  "okrs",
];

/**
 * Broad practice / capability umbrellas: never stored as granular *skills*.
 * Some are moved to *methods*; vague meta-labels are dropped entirely.
 */
const ROUTE_TO_METHOD_AS_PRACTICE: readonly string[] = [
  "business analysis",
  "project management",
  "product management",
  "program management",
  "change management",
  "stakeholder management",
];

const DROP_VAGUE: readonly string[] = [
  "consulting",
  "leadership",
  "management",
  "strategy",
  "communication",
  "teamwork",
  "team work",
  "hardworking",
  "motivated",
];

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  if (haystack === phrase) return true;
  if (haystack.startsWith(`${phrase} `)) return true;
  if (haystack.endsWith(` ${phrase}`)) return true;
  if (haystack.includes(` ${phrase} `)) return true;
  return false;
}

export type ClassifyResult =
  | { outcome: "skill"; label: string }
  | { outcome: "method"; label: string }
  | { outcome: "tool"; label: string }
  | { outcome: "drop" };

/**
 * Classify a single free-text tag into skill / method / tool, or drop.
 * Uses conservative phrase lists; unknown strings default to **skill** (specific capability).
 */
export function classifyTag(raw: unknown): ClassifyResult {
  const label = normalizeSkillLabel(String(raw));
  if (!label) return { outcome: "drop" };
  const key = normKey(label);

  for (const v of DROP_VAGUE) {
    if (key === v) return { outcome: "drop" };
  }

  for (const phrase of TOOL_PHRASES) {
    if (matchesPhrase(key, phrase)) return { outcome: "tool", label };
  }

  for (const phrase of METHOD_PHRASES) {
    if (matchesPhrase(key, phrase)) return { outcome: "method", label };
  }

  for (const phrase of ROUTE_TO_METHOD_AS_PRACTICE) {
    if (key === phrase || matchesPhrase(key, phrase)) {
      return { outcome: "method", label };
    }
  }

  return { outcome: "skill", label };
}

/**
 * Merge explicit buckets from extractors with any legacy `skills` list.
 * - `methods` / `tools` from the model are kept as-is (normalised, deduped).
 * - Each string in `skills` is classified so mis-filed tools/methods move out; broad labels
 *   never remain as skills when rules route them to methods or drop them.
 */
export function mergeExtractedEvidenceTags(input: {
  skills: string[];
  methods?: string[] | null;
  tools?: string[] | null;
}): EvidenceTagBuckets {
  const skillsOut: string[] = [];
  const methodsOut: string[] = [];
  const toolsOut: string[] = [];

  const pushUnique = (arr: string[], label: string) => {
    const n = normalizeSkillLabel(label);
    if (!n) return;
    const k = n.toLowerCase();
    if (arr.some((x) => x.toLowerCase() === k)) return;
    arr.push(n);
  };

  for (const t of input.tools ?? []) {
    const n = normalizeSkillLabel(String(t));
    if (n) pushUnique(toolsOut, n);
  }
  for (const t of input.methods ?? []) {
    const n = normalizeSkillLabel(String(t));
    if (n) pushUnique(methodsOut, n);
  }

  for (const raw of input.skills ?? []) {
    const c = classifyTag(raw);
    if (c.outcome === "drop") continue;
    if (c.outcome === "tool") {
      pushUnique(toolsOut, c.label);
      continue;
    }
    if (c.outcome === "method") {
      pushUnique(methodsOut, c.label);
      continue;
    }
    pushUnique(skillsOut, c.label);
  }

  return postProcessEvidenceBuckets({
    skills: dedupeSkillsNormalized(skillsOut),
    methods: dedupeSkillsNormalized(methodsOut),
    tools: dedupeSkillsNormalized(toolsOut),
  });
}

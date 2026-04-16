import type { CompetencyPracticeLinkRow } from "./competencyPracticeLinks";
import type { CompetencyLevelDefinitionRow, CompetencyRow } from "./types";
import { isAssignableLifecycleStatus } from "./competencyLifecycle";

/** Role seniority used to pick a default point on each competency's level scale. */
export type RoleCapabilitySeniority =
  | "associate"
  | "intermediate"
  | "senior"
  | "principal";

export function roleCapabilitySeniorityLabel(
  s: RoleCapabilitySeniority,
): string {
  switch (s) {
    case "associate":
      return "Associate";
    case "intermediate":
      return "Intermediate";
    case "senior":
      return "Senior";
    case "principal":
      return "Principal";
    default:
      return "Intermediate";
  }
}

/**
 * Pick an index into ascending level definitions (low → high) from seniority.
 */
export function pickLevelIndexForSeniority(
  seniority: RoleCapabilitySeniority,
  levelCount: number,
): number {
  if (levelCount <= 0) return 0;
  if (levelCount === 1) return 0;
  const max = levelCount - 1;
  switch (seniority) {
    case "associate":
      return Math.max(0, Math.floor(max * 0.22));
    case "intermediate":
      return Math.round(max * 0.45);
    case "senior":
      return Math.round(max * 0.72);
    case "principal":
      return max;
    default:
      return Math.round(max * 0.45);
  }
}

/** `defs` must be sorted by level_order ascending. */
export function defaultLevelNameForDefinitions(
  seniority: RoleCapabilitySeniority,
  defs: CompetencyLevelDefinitionRow[],
): string | null {
  if (defs.length === 0) return null;
  const idx = pickLevelIndexForSeniority(seniority, defs.length);
  return defs[idx]?.level_name?.trim() || null;
}

export function competencyIdsLinkedToPractice(
  practiceId: string,
  links: CompetencyPracticeLinkRow[],
): Set<string> {
  const s = new Set<string>();
  for (const l of links) {
    if (l.practice_id === practiceId) s.add(l.competency_id);
  }
  return s;
}

export type PracticeRoleImportPreview = {
  competencyIds: string[];
  competencyCount: number;
  subjectCount: number;
};

/**
 * Competencies in the org catalogue that are linked to the practice overlay
 * (competency_practice_links) and assignable.
 */
export function previewPracticeRoleImport(
  practiceId: string,
  competencyPracticeLinks: CompetencyPracticeLinkRow[],
  competencies: CompetencyRow[],
): PracticeRoleImportPreview {
  const linked = competencyIdsLinkedToPractice(practiceId, competencyPracticeLinks);
  const ids: string[] = [];
  const subjects = new Set<string>();
  for (const c of competencies) {
    if (!linked.has(c.id)) continue;
    if (!isAssignableLifecycleStatus(c.status ?? "active")) continue;
    ids.push(c.id);
    if (c.subject_id) subjects.add(c.subject_id);
  }
  ids.sort();
  return {
    competencyIds: ids,
    competencyCount: ids.length,
    subjectCount: subjects.size,
  };
}

export type RoleCapabilityBuildSummary = {
  lines: string[];
  addedFromPractice: number;
  skippedAlreadyOnRole: number;
  skippedNoLevel: number;
  addedAugmentation: number;
  appliedSeniorityLabel: string;
};

export function summarizeRoleCapabilityBuildResult(input: {
  practiceName: string | null;
  addedFromPractice: number;
  skippedAlreadyOnRole: number;
  skippedNoLevel: number;
  addedAugmentation: number;
  seniorityLabel: string;
}): RoleCapabilityBuildSummary {
  const lines: string[] = [];
  if (input.addedFromPractice > 0 && input.practiceName?.trim()) {
    lines.push(
      `Added ${input.addedFromPractice} competencies from ${input.practiceName.trim()}.`,
    );
  } else if (input.addedFromPractice > 0) {
    lines.push(`Added ${input.addedFromPractice} competencies from practice.`);
  }
  if (input.addedFromPractice > 0 || input.addedAugmentation > 0) {
    lines.push(
      `Applied default ${input.seniorityLabel} level expectations.`,
    );
  }
  if (input.addedAugmentation > 0) {
    lines.push(`Added ${input.addedAugmentation} AI-suggested competencies.`);
  }
  if (input.skippedAlreadyOnRole > 0) {
    lines.push(
      `${input.skippedAlreadyOnRole} competencies were already on this role and were skipped.`,
    );
  }
  if (input.skippedNoLevel > 0) {
    lines.push(
      `${input.skippedNoLevel} competencies were skipped (no active level scale in catalogue).`,
    );
  }
  return {
    lines,
    addedFromPractice: input.addedFromPractice,
    skippedAlreadyOnRole: input.skippedAlreadyOnRole,
    skippedNoLevel: input.skippedNoLevel,
    addedAugmentation: input.addedAugmentation,
    appliedSeniorityLabel: input.seniorityLabel,
  };
}

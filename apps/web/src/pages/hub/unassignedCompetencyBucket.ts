import type { CompetencyRow } from "./types";

/**
 * Matches the "Competencies not linked to a subject" bucket in
 * `buildCapabilityAreaManagementGroups`: competencies that either have no
 * `subject_id`, or whose `subject_id` is not among subjects shown in the
 * current catalogue tree (orphan / filtered-out subject).
 */
export function getCompetenciesInUnassignedSubjectBucket(
  filteredCompetencies: CompetencyRow[],
  subjectIdsInCapabilityTree: Set<string>
): CompetencyRow[] {
  const rows = filteredCompetencies.filter((c) => {
    const sid = c.subject_id ?? null;
    return !sid || !subjectIdsInCapabilityTree.has(sid);
  });
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

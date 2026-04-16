import { isAssignableLifecycleStatus } from "./competencyLifecycle";

/** IDs of active (non-archived) competencies linked to a subject — for archive / detach flows. */
export function activeCompetencyIdsForSubject(
  rows: { id: string; subject_id?: string | null; status?: string | null }[],
  subjectId: string,
): string[] {
  return rows
    .filter(
      (c) =>
        c.subject_id === subjectId && isAssignableLifecycleStatus(c.status),
    )
    .map((c) => c.id);
}

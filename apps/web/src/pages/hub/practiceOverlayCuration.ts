import {
  addCompetencyPracticeLink,
  competencyLinkedToPractice,
  removeCompetencyPracticeLinksForSubjectInPractice,
  type CompetencyPracticeLinkRow,
} from "./competencyPracticeLinks";
import { addSubjectPracticeLink } from "./subjectPracticeLinks";
import { removeSubjectPracticeRelevanceForPractice } from "./subjectPracticeLinks";
import { isAssignableLifecycleStatus } from "./competencyLifecycle";
import type { CompetencyRow } from "./types";

/** Re-export for callers that want one import surface. */
export { addCompetencyPracticeLink } from "./competencyPracticeLinks";
export { addSubjectPracticeLink } from "./subjectPracticeLinks";
export {
  removeCompetencyPracticeLink,
  removeCompetencyPracticeLinksForCompetencies,
  removeCompetencyPracticeLinksForSubjectInPractice,
} from "./competencyPracticeLinks";

/**
 * Remove subject practice relevance and all competency-practice links for competencies
 * under that subject in this practice. Does not delete taxonomy rows.
 */
export async function removeSubjectFromPracticeOverlay(
  organisationId: string,
  practiceId: string,
  subjectId: string,
): Promise<{ error: Error | null }> {
  const r1 = await removeCompetencyPracticeLinksForSubjectInPractice(
    organisationId,
    practiceId,
    subjectId,
  );
  if (r1.error) return r1;
  return removeSubjectPracticeRelevanceForPractice(
    organisationId,
    subjectId,
    practiceId,
  );
}

/** Idempotent: ensures subject_practice_links row (duplicate OK). */
export async function ensureSubjectLinkedToPracticeOrganisation(
  organisationId: string,
  practiceId: string,
  competencySubjectId: string,
): Promise<{ error: Error | null }> {
  return addSubjectPracticeLink(
    organisationId,
    competencySubjectId,
    practiceId,
  );
}

/** Idempotent: ensures competency_practice_links row (duplicate OK). */
export async function ensureCompetencyLinkedToPracticeOrganisation(
  organisationId: string,
  practiceId: string,
  competencyId: string,
): Promise<{ error: Error | null }> {
  return addCompetencyPracticeLink(organisationId, competencyId, practiceId);
}

/** Competencies under the subject not yet linked to this practice overlay. */
export function listPracticeCandidateCompetenciesForSubject(
  practiceId: string,
  subjectId: string,
  competencies: CompetencyRow[],
  links: CompetencyPracticeLinkRow[],
): CompetencyRow[] {
  return competencies
    .filter(
      (c) =>
        c.subject_id === subjectId &&
        isAssignableLifecycleStatus(c.status ?? "active"),
    )
    .filter(
      (c) => !competencyLinkedToPractice(links, c.id, practiceId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** All assignable competencies under the subject (for manage UI). */
export function listPracticeManagedCompetenciesForSubject(
  practiceId: string,
  subjectId: string,
  competencies: CompetencyRow[],
  _links: CompetencyPracticeLinkRow[],
): CompetencyRow[] {
  void practiceId;
  void _links;
  return competencies
    .filter(
      (c) =>
        c.subject_id === subjectId &&
        isAssignableLifecycleStatus(c.status ?? "active"),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

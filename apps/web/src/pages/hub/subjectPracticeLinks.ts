import { supabase } from "../../lib/supabase";
import type { CompetencySubjectRow } from "./types";

export type SubjectPracticeLinkRow = {
  id: string;
  organisation_id: string;
  subject_id: string;
  practice_id: string;
  created_at: string;
};

/** Legacy competency_subjects.practice_id is unioned until reads fully migrate. */
export function practiceIdsForSubjectDisplay(
  links: SubjectPracticeLinkRow[],
  subjectId: string,
  legacyPracticeId?: string | null
): string[] {
  const ids = new Set(
    links.filter((l) => l.subject_id === subjectId).map((l) => l.practice_id)
  );
  if (legacyPracticeId && !ids.has(legacyPracticeId)) {
    ids.add(legacyPracticeId);
  }
  return [...ids];
}

export function subjectIsRelevantToPractice(
  links: SubjectPracticeLinkRow[],
  subjectId: string,
  practiceId: string,
  legacy?: Pick<CompetencySubjectRow, "practice_id"> | null
): boolean {
  if (legacy?.practice_id === practiceId) return true;
  return links.some(
    (l) => l.subject_id === subjectId && l.practice_id === practiceId
  );
}

export function linkExistsInMemory(
  links: SubjectPracticeLinkRow[],
  subjectId: string,
  practiceId: string
): boolean {
  return links.some(
    (l) => l.subject_id === subjectId && l.practice_id === practiceId
  );
}

export async function fetchSubjectPracticeLinksForOrg(
  organisationId: string
): Promise<SubjectPracticeLinkRow[]> {
  const { data, error } = await supabase
    .from("subject_practice_links")
    .select("id, organisation_id, subject_id, practice_id, created_at")
    .eq("organisation_id", organisationId);
  if (error) {
    console.error(error);
    return [];
  }
  return (data as SubjectPracticeLinkRow[]) ?? [];
}

export async function replaceSubjectPracticeLinksForSubject(
  organisationId: string,
  subjectId: string,
  practiceIds: string[]
): Promise<{ error: Error | null }> {
  const { error: delErr } = await supabase
    .from("subject_practice_links")
    .delete()
    .eq("organisation_id", organisationId)
    .eq("subject_id", subjectId);
  if (delErr) return { error: new Error(delErr.message) };
  const uniq = [...new Set(practiceIds.filter(Boolean))];
  if (uniq.length === 0) return { error: null };
  const rows = uniq.map((practice_id) => ({
    organisation_id: organisationId,
    subject_id: subjectId,
    practice_id,
  }));
  const { error: insErr } = await supabase
    .from("subject_practice_links")
    .insert(rows);
  if (insErr) return { error: new Error(insErr.message) };
  return { error: null };
}

/** Idempotent: duplicate link returns success (unique constraint). */
export async function addSubjectPracticeLink(
  organisationId: string,
  subjectId: string,
  practiceId: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase.from("subject_practice_links").insert({
    organisation_id: organisationId,
    subject_id: subjectId,
    practice_id: practiceId,
  });
  if (error) {
    if (error.code === "23505") return { error: null };
    return { error: new Error(error.message) };
  }
  return { error: null };
}

/**
 * Remove this subject’s relevance to this practice only: deletes the link row if present,
 * and clears legacy `competency_subjects.practice_id` when it equals this practice (so the
 * subject drops from this practice in the UI). Does not delete the subject or touch competencies.
 */
export async function removeSubjectPracticeRelevanceForPractice(
  organisationId: string,
  subjectId: string,
  practiceId: string
): Promise<{ error: Error | null }> {
  const { error: delErr } = await supabase
    .from("subject_practice_links")
    .delete()
    .eq("organisation_id", organisationId)
    .eq("subject_id", subjectId)
    .eq("practice_id", practiceId);
  if (delErr) return { error: new Error(delErr.message) };

  const { data: sub, error: fetchErr } = await supabase
    .from("competency_subjects")
    .select("practice_id")
    .eq("id", subjectId)
    .eq("organisation_id", organisationId)
    .maybeSingle();
  if (fetchErr) return { error: new Error(fetchErr.message) };
  if (sub?.practice_id === practiceId) {
    const { error: upErr } = await supabase
      .from("competency_subjects")
      .update({ practice_id: null })
      .eq("id", subjectId)
      .eq("organisation_id", organisationId);
    if (upErr) return { error: new Error(upErr.message) };
  }
  return { error: null };
}

import { supabase } from "../../lib/supabase";

export type CompetencyPracticeLinkRow = {
  id: string;
  organisation_id: string;
  competency_id: string;
  practice_id: string;
  created_at: string;
};

export async function fetchCompetencyPracticeLinksForOrg(
  organisationId: string,
): Promise<CompetencyPracticeLinkRow[]> {
  const { data, error } = await supabase
    .from("competency_practice_links")
    .select("id, organisation_id, competency_id, practice_id, created_at")
    .eq("organisation_id", organisationId);
  if (error) {
    console.error(error);
    return [];
  }
  return (data as CompetencyPracticeLinkRow[]) ?? [];
}

/** Idempotent: duplicate link returns success (unique constraint). */
export async function addCompetencyPracticeLink(
  organisationId: string,
  competencyId: string,
  practiceId: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.from("competency_practice_links").insert({
    organisation_id: organisationId,
    competency_id: competencyId,
    practice_id: practiceId,
  });
  if (error) {
    if (error.code === "23505") return { error: null };
    return { error: new Error(error.message) };
  }
  return { error: null };
}

export function competencyLinkedToPractice(
  links: CompetencyPracticeLinkRow[],
  competencyId: string,
  practiceId: string,
): boolean {
  return links.some(
    (l) => l.competency_id === competencyId && l.practice_id === practiceId,
  );
}

/** Deletes practice links for all competencies under a subject (scoped to one practice). */
export async function removeCompetencyPracticeLinksForSubjectInPractice(
  organisationId: string,
  practiceId: string,
  subjectId: string,
): Promise<{ error: Error | null }> {
  const { data: comps, error: qErr } = await supabase
    .from("competencies")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("subject_id", subjectId);
  if (qErr) return { error: new Error(qErr.message) };
  const ids = (comps ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return { error: null };
  const { error: delErr } = await supabase
    .from("competency_practice_links")
    .delete()
    .eq("organisation_id", organisationId)
    .eq("practice_id", practiceId)
    .in("competency_id", ids);
  if (delErr) return { error: new Error(delErr.message) };
  return { error: null };
}

export async function removeCompetencyPracticeLinksForCompetencies(
  organisationId: string,
  practiceId: string,
  competencyIds: string[],
): Promise<{ error: Error | null }> {
  const uniq = [...new Set(competencyIds.filter(Boolean))];
  if (uniq.length === 0) return { error: null };
  const { error } = await supabase
    .from("competency_practice_links")
    .delete()
    .eq("organisation_id", organisationId)
    .eq("practice_id", practiceId)
    .in("competency_id", uniq);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

export async function removeCompetencyPracticeLink(
  organisationId: string,
  practiceId: string,
  competencyId: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from("competency_practice_links")
    .delete()
    .eq("organisation_id", organisationId)
    .eq("practice_id", practiceId)
    .eq("competency_id", competencyId);
  if (error) return { error: new Error(error.message) };
  return { error: null };
}

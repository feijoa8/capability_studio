import { supabase } from "../../lib/supabase";

export type CompetencyArchiveImpact = {
  orgUserCompetencies: number;
  jobProfileLinks: number;
  assessments: number;
  developmentGoals: number;
  planObjectives: number;
};

/**
 * Counts of rows that reference this competency (soft archive keeps the competency row;
 * links remain valid — used for informed confirmation only).
 */
export async function fetchCompetencyArchiveImpact(
  organisationId: string,
  competencyId: string
): Promise<CompetencyArchiveImpact> {
  const [
    ouc,
    jpc,
    assess,
    goals,
    planObj,
  ] = await Promise.all([
    supabase
      .from("org_user_competencies")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("competency_id", competencyId),
    supabase
      .from("job_profile_competencies")
      .select("id", { count: "exact", head: true })
      .eq("competency_id", competencyId),
    supabase
      .from("org_user_competency_assessments")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("competency_id", competencyId),
    supabase
      .from("development_goals")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("competency_id", competencyId),
    supabase
      .from("development_plan_objectives")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("competency_id", competencyId),
  ]);

  const firstError = [ouc, jpc, assess, goals, planObj].find((r) => r.error)?.error;
  if (firstError) {
    throw new Error(firstError.message || "Could not load archive impact.");
  }

  return {
    orgUserCompetencies: ouc.count ?? 0,
    jobProfileLinks: jpc.count ?? 0,
    assessments: assess.count ?? 0,
    developmentGoals: goals.count ?? 0,
    planObjectives: planObj.count ?? 0,
  };
}

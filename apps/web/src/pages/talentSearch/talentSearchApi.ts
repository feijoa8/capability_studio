import { supabase } from "../../lib/supabase";

export type TalentSearchScope = "internal" | "external" | "both";

export type TalentSearchResultRow = {
  source_type: "internal" | "external";
  user_id: string;
  application_id: string | null;
  display_name: string;
  current_title: string | null;
  years_experience: number | null;
  skills: string[];
  highlights: (string | null)[];
  match_score: number;
  contact_allowed: boolean;
  summary: string | null;
};

export type TalentProfileDetailPayload = {
  profile: {
    display_name: string;
    summary: string | null;
    location: string | null;
    source_type: string;
    contact_allowed: boolean;
    linkedin_url?: string | null;
    email?: string | null;
    application_answers?: unknown;
    cv_extract_snapshot?: unknown;
    /** Present for internal + external (View CV / identity). */
    candidate_user_id?: string;
    /** External application (Talent Search detail). */
    application_id?: string | null;
    /** Submitted CV upload; used with `openHiringApplicationCv` when set. */
    cv_upload_id?: string | null;
  };
  experience: Array<{
    role_title: string | null;
    organisation_name: string | null;
    description: string | null;
    industry: string | null;
    start_date: string | null;
    end_date: string | null;
    skills: string[] | null;
  }>;
};

/** Tokenise natural language + structured filters into search terms (server scores by substring match). */
export function buildSearchTerms(input: {
  naturalLanguage: string;
  skillsKeywords: string;
  industry: string;
  location: string;
  availability: string;
}): string[] {
  const raw = [
    input.naturalLanguage,
    input.skillsKeywords,
    input.industry,
    input.location,
    input.availability,
  ]
    .filter(Boolean)
    .join(" ");
  const parts = raw.split(/[\s,.;]+/).map((w) => w.trim().toLowerCase());
  const out = new Set<string>();
  for (const p of parts) {
    if (p.length >= 2) out.add(p);
  }
  return Array.from(out);
}

export async function runTalentSearch(args: {
  organisationId: string;
  scope: TalentSearchScope;
  terms: string[];
  minYears: number;
  referenceJobProfileId: string | null;
  referenceRoleText: string;
  limit?: number;
}): Promise<TalentSearchResultRow[]> {
  const { data, error } = await supabase.rpc("search_workspace_talent_mvp", {
    p_org_id: args.organisationId,
    p_scope: args.scope,
    p_terms: args.terms.length > 0 ? args.terms : null,
    p_min_years: args.minYears > 0 ? args.minYears : null,
    p_reference_job_profile_id: args.referenceJobProfileId,
    p_reference_role_text: args.referenceRoleText.trim() || null,
    p_limit: args.limit ?? 30,
  });

  if (error) throw new Error(error.message);
  const rows = data as unknown;
  if (!Array.isArray(rows)) return [];
  return rows as TalentSearchResultRow[];
}

export async function fetchTalentProfileDetail(args: {
  organisationId: string;
  kind: "internal" | "external";
  userId: string;
  applicationId: string | null;
}): Promise<TalentProfileDetailPayload> {
  const { data, error } = await supabase.rpc("get_workspace_talent_profile_detail", {
    p_org_id: args.organisationId,
    p_kind: args.kind,
    p_user_id: args.userId,
    p_application_id: args.applicationId,
  });

  if (error) throw new Error(error.message);
  return data as TalentProfileDetailPayload;
}

import { supabase } from "./supabase";
import { toMinimalCompanyProfilePayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";

async function invokeErrorMessage(
  error: { message?: string; context?: unknown },
  data: unknown
): Promise<string> {
  let msg = error.message ?? "Edge function request failed.";
  const ctx = error.context;
  if (ctx instanceof Response) {
    try {
      const text = await ctx.clone().text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            msg = parsed.error.trim();
          }
        } catch {
          msg = text.length > 500 ? `${text.slice(0, 500)}…` : text;
        }
      }
    } catch {
      /* keep */
    }
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) msg = e.trim();
  }
  return msg;
}

export type UnassignedCompetencyRefinementConfidence = "high" | "medium" | "low";

export type UnassignedCompetencySuggestion = {
  competency_id: string;
  suggested_subject_name: string;
  confidence: UnassignedCompetencyRefinementConfidence;
  reason: string;
  duplicate_or_merge_note: string | null;
  may_be_subject_instead: boolean;
};

export type UnassignedCompetencyRefinementResult = {
  suggestions: UnassignedCompetencySuggestion[];
};

export type SubjectAnchorPayload = {
  id: string;
  name: string;
  description: string | null;
  governance_status: string;
  capability_area_name: string | null;
  capability_area_governance: string | null;
};

export async function analyzeUnassignedCompetencies(input: {
  companyProfile: OrganisationProfileRow | null;
  subjectAnchors: SubjectAnchorPayload[];
  competencies: {
    id: string;
    name: string;
    description: string | null;
    competency_type?: string | null;
  }[];
}): Promise<UnassignedCompetencyRefinementResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in to run analysis. Your session may have expired."
    );
  }
  const { data, error } = await supabase.functions.invoke(
    "refine-unassigned-competencies",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        companyProfile: toMinimalCompanyProfilePayload(input.companyProfile),
        subjectAnchors: input.subjectAnchors,
        competencies: input.competencies,
      },
    }
  );
  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from refine-unassigned-competencies.");
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.suggestions)) {
    throw new Error("Response missing suggestions array.");
  }
  return data as UnassignedCompetencyRefinementResult;
}

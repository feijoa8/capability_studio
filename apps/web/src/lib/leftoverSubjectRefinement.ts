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

export type LeftoverRefinementConfidence = "high" | "medium" | "low";

export type LeftoverSubjectSuggestion = {
  subject_id: string;
  suggested_capability_area_name: string;
  confidence: LeftoverRefinementConfidence;
  reason: string;
  close_variant_or_merge_note: string | null;
  may_be_competency_instead: boolean;
};

export type LeftoverSubjectRefinementResult = {
  suggestions: LeftoverSubjectSuggestion[];
};

export async function analyzeLeftoverSubjects(input: {
  companyProfile: OrganisationProfileRow | null;
  capabilityAreas: {
    id: string;
    name: string;
    description: string | null;
    governance_status?: string | null;
  }[];
  subjects: {
    id: string;
    name: string;
    description: string | null;
    governance_status?: string | null;
  }[];
}): Promise<LeftoverSubjectRefinementResult> {
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
    "refine-leftover-subjects",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        companyProfile: toMinimalCompanyProfilePayload(input.companyProfile),
        capabilityAreas: input.capabilityAreas,
        subjects: input.subjects,
      },
    }
  );
  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from refine-leftover-subjects.");
  }
  const o = data as Record<string, unknown>;
  const sug = o.suggestions;
  if (!Array.isArray(sug)) {
    throw new Error("Response missing suggestions array.");
  }
  return data as LeftoverSubjectRefinementResult;
}

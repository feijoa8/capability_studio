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

export type PracticeCoverageConfidence = "high" | "medium" | "low";

export type PracticeCoverageLinkExisting = {
  subject_id: string;
  confidence: PracticeCoverageConfidence;
  reason: string;
  duplicate_or_close_match_note: string | null;
};

export type PracticeCoverageMissingArea = {
  proposed_name: string;
  proposed_description: string | null;
  suggested_capability_area_name: string | null;
  confidence: PracticeCoverageConfidence;
  reason: string;
  duplicate_or_close_match_note: string | null;
};

export type PracticeCoverageRefinementResult = {
  link_existing: PracticeCoverageLinkExisting[];
  missing_areas: PracticeCoverageMissingArea[];
};

export async function analyzePracticeCoverage(input: {
  companyProfile: OrganisationProfileRow | null;
  practice: { id: string; name: string; description: string | null };
  subjects: {
    id: string;
    name: string;
    description: string | null;
    type: string | null;
    /** @deprecated Legacy single column; prefer practice_context_ids */
    practice_id: string | null;
    /** Practices this subject is relevant to (subject_practice_links + legacy). */
    practice_context_ids: string[];
    governance_status: string | null;
    capability_area_id: string | null;
  }[];
  capabilityAreas: {
    id: string;
    name: string;
    description: string | null;
    governance_status: string | null;
  }[];
}): Promise<PracticeCoverageRefinementResult> {
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
    "refine-practice-coverage",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        companyProfile: toMinimalCompanyProfilePayload(input.companyProfile),
        practice: {
          id: input.practice.id,
          name: input.practice.name,
          description: input.practice.description,
        },
        subjects: input.subjects,
        capabilityAreas: input.capabilityAreas,
      },
    }
  );
  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from refine-practice-coverage.");
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.link_existing) || !Array.isArray(o.missing_areas)) {
    throw new Error("Response missing link_existing or missing_areas.");
  }
  return data as PracticeCoverageRefinementResult;
}

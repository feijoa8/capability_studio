import { supabase } from "./supabase";
import { toHierarchyCompanyProfilePayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";

/** Same normalization as Skills: trim, lowercase, collapse spaces. */
export function normalizeHrLineKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

async function invokeErrorMessage(
  error: { message?: string; context?: unknown },
  data: unknown,
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
      /* keep msg */
    }
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) msg = e.trim();
  }
  return msg;
}

export type JobProfileResponsibilitySuggestionInput = {
  companyProfile: OrganisationProfileRow | null;
  jobTitle: string;
  levelName: string | null;
  familyName: string | null;
  roleSummary: string | null;
  existingResponsibilities: string[];
  requirements: string[];
};

export type JobProfileResponsibilitySuggestionResult = {
  suggested_responsibilities: string[];
};

export async function suggestJobProfileResponsibilities(
  input: JobProfileResponsibilitySuggestionInput,
): Promise<JobProfileResponsibilitySuggestionResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in. Your session may have expired — sign in again.",
    );
  }

  const { data, error } = await supabase.functions.invoke(
    "suggest-job-profile-responsibilities",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        companyProfile: toHierarchyCompanyProfilePayload(input.companyProfile),
        jobProfile: {
          title: input.jobTitle,
          level: input.levelName,
          job_family: input.familyName,
          role_summary: input.roleSummary,
          existing_responsibilities: input.existingResponsibilities,
          requirements: input.requirements,
        },
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from suggestion service.");
  }
  const o = data as Record<string, unknown>;
  const arr = o.suggested_responsibilities;
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
    throw new Error("Response missing suggested_responsibilities array.");
  }
  const suggested_responsibilities = arr.map((s) => s.trim()).filter(Boolean);
  return { suggested_responsibilities };
}

export type JobProfileRequirementSuggestionInput = {
  companyProfile: OrganisationProfileRow | null;
  jobTitle: string;
  levelName: string | null;
  familyName: string | null;
  roleSummary: string | null;
  responsibilities: string[];
  existingRequirements: string[];
};

export type JobProfileRequirementSuggestionResult = {
  suggested_requirements: string[];
};

export async function suggestJobProfileRequirements(
  input: JobProfileRequirementSuggestionInput,
): Promise<JobProfileRequirementSuggestionResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in. Your session may have expired — sign in again.",
    );
  }

  const { data, error } = await supabase.functions.invoke(
    "suggest-job-profile-requirements",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        companyProfile: toHierarchyCompanyProfilePayload(input.companyProfile),
        jobProfile: {
          title: input.jobTitle,
          level: input.levelName,
          job_family: input.familyName,
          role_summary: input.roleSummary,
          responsibilities: input.responsibilities,
          existing_requirements: input.existingRequirements,
        },
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from suggestion service.");
  }
  const o = data as Record<string, unknown>;
  const arr = o.suggested_requirements;
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
    throw new Error("Response missing suggested_requirements array.");
  }
  const suggested_requirements = arr.map((s) => s.trim()).filter(Boolean);
  return { suggested_requirements };
}

import { supabase } from "./supabase";
import { toHierarchyCompanyProfilePayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";

/** Pass 1: role description / purpose refinement only. */
export type JobProfileRefinementInput = {
  companyProfile: OrganisationProfileRow | null;
  jobTitle: string;
  levelName: string | null;
  /** Job family display name when assigned */
  familyName: string | null;
  /** Existing narrative (role_summary) when present */
  description: string | null;
  responsibilities: string[];
  requirements: string[];
};

export type JobProfileRefinementResult = {
  refined_role_summary: string;
};

function parseRefinementResult(data: unknown): JobProfileRefinementResult {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from refinement service.");
  }
  const o = data as Record<string, unknown>;
  const refined_role_summary =
    typeof o.refined_role_summary === "string"
      ? o.refined_role_summary.trim()
      : "";
  if (!refined_role_summary) {
    throw new Error("Refinement response missing refined_role_summary.");
  }
  return { refined_role_summary };
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

/**
 * Calls Supabase Edge Function `refine-job-profile` (OpenAI runs server-side).
 * Sends the user JWT so `verify_jwt = true` accepts the request.
 */
export async function refineJobProfileWithCompanyContext(
  input: JobProfileRefinementInput,
): Promise<JobProfileRefinementResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (import.meta.env.DEV) {
    console.log("[refine-job-profile] session access_token present:", Boolean(
      session?.access_token,
    ));
  }

  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in to refine a job profile. Your session may have expired — sign in again.",
    );
  }

  const { data, error } = await supabase.functions.invoke(
    "refine-job-profile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        companyProfile: toHierarchyCompanyProfilePayload(input.companyProfile),
        jobProfile: {
          title: input.jobTitle,
          level: input.levelName,
          job_family: input.familyName,
          role_summary: input.description,
          responsibilities: input.responsibilities,
          requirements: input.requirements,
        },
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  return parseRefinementResult(data);
}

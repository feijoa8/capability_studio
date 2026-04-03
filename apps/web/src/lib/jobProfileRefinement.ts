import { supabase } from "./supabase";
import type { OrganisationProfileRow } from "../pages/hub/types";

export type JobProfileRefinementInput = {
  companyProfile: OrganisationProfileRow | null;
  jobTitle: string;
  levelName: string | null;
  /** Existing narrative (e.g. role_summary) when present */
  description: string | null;
  responsibilities: string[];
};

export type JobProfileRefinementResult = {
  refined_role_summary: string;
  improved_responsibilities: string[];
  suggested_requirements: string[];
  suggested_capabilities: string[];
};

/** Subset sent to Edge Function `refine-job-profile` */
type RefineJobProfileCompanyPayload = {
  sector: string | null;
  industry: string | null;
  summary: string | null;
  business_purpose: string | null;
  strategic_priorities: string | null;
  delivery_context: string | null;
  capability_emphasis: string | null;
  role_interpretation_guidance: string | null;
  terminology_guidance: string | null;
};

function mapCompanyProfile(
  row: OrganisationProfileRow | null,
): RefineJobProfileCompanyPayload | null {
  if (!row) return null;
  return {
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    summary: row.summary ?? null,
    business_purpose: row.business_purpose ?? null,
    strategic_priorities: row.strategic_priorities ?? null,
    delivery_context: row.delivery_context ?? null,
    capability_emphasis: row.capability_emphasis ?? null,
    role_interpretation_guidance: row.role_interpretation_guidance ?? null,
    terminology_guidance: row.terminology_guidance ?? null,
  };
}

function parseRefinementResult(data: unknown): JobProfileRefinementResult {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from refinement service.");
  }
  const o = data as Record<string, unknown>;
  const refined_role_summary =
    typeof o.refined_role_summary === "string"
      ? o.refined_role_summary.trim()
      : "";
  const ir = o.improved_responsibilities;
  const req = o.suggested_requirements;
  const sc = o.suggested_capabilities;
  if (!refined_role_summary) {
    throw new Error("Refinement response missing refined_role_summary.");
  }
  if (!Array.isArray(ir) || !ir.every((x) => typeof x === "string")) {
    throw new Error("Refinement response missing improved_responsibilities.");
  }
  if (!Array.isArray(req) || !req.every((x) => typeof x === "string")) {
    throw new Error("Refinement response missing suggested_requirements.");
  }
  if (!Array.isArray(sc) || !sc.every((x) => typeof x === "string")) {
    throw new Error("Refinement response missing suggested_capabilities.");
  }
  return {
    refined_role_summary,
    improved_responsibilities: ir.map((s) => s.trim()).filter(Boolean),
    suggested_requirements: req.map((s) => s.trim()).filter(Boolean),
    suggested_capabilities: sc.map((s) => s.trim()).filter(Boolean),
  };
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
        companyProfile: mapCompanyProfile(input.companyProfile),
        jobProfile: {
          title: input.jobTitle,
          level: input.levelName,
          role_summary: input.description,
          responsibilities: input.responsibilities,
        },
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  return parseRefinementResult(data);
}

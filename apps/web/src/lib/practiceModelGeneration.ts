import { supabase } from "./supabase";
import type { OrganisationProfileRow } from "../pages/hub/types";

export type GeneratedPracticeDraft = {
  name: string;
  description: string;
};

export type GeneratePracticeModelResult = {
  practices: GeneratedPracticeDraft[];
};

type CompanyProfilePayload = {
  organisation_name: string | null;
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
): CompanyProfilePayload | null {
  if (!row) return null;
  return {
    organisation_name: row.organisation_name ?? null,
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

function parseResult(data: unknown): GeneratePracticeModelResult {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from generate-practice-model.");
  }
  const o = data as Record<string, unknown>;
  const arr = o.practices;
  if (!Array.isArray(arr)) {
    throw new Error("Response missing practices array.");
  }
  const practices: GeneratedPracticeDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const description =
      typeof row.description === "string" ? row.description.trim() : "";
    if (name) practices.push({ name, description });
  }
  if (practices.length === 0) {
    throw new Error("No practices returned.");
  }
  return { practices };
}

export async function generatePracticeModelWithAi(input: {
  companyProfile: OrganisationProfileRow | null;
  domain: string | null;
  focus: string | null;
}): Promise<GeneratePracticeModelResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in to generate a practice model. Your session may have expired — sign in again.",
    );
  }

  const { data, error } = await supabase.functions.invoke(
    "generate-practice-model",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        companyProfile: mapCompanyProfile(input.companyProfile),
        domain: input.domain?.trim() || null,
        focus: input.focus?.trim() || null,
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  return parseResult(data);
}

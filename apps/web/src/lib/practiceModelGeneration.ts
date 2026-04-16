import { supabase } from "./supabase";
import { toHierarchyCompanyProfilePayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";

export type GeneratedPracticeDraft = {
  name: string;
  description: string;
};

export type GeneratePracticeModelResult = {
  practices: GeneratedPracticeDraft[];
};

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
  /** Organisation practice names to treat as stable anchors (no duplicate or near-duplicate proposals). */
  existingPracticeNames?: string[];
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
        companyProfile: toHierarchyCompanyProfilePayload(input.companyProfile),
        domain: input.domain?.trim() || null,
        focus: input.focus?.trim() || null,
        existingPracticeNames: input.existingPracticeNames ?? [],
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  return parseResult(data);
}

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

export type CapabilityAreaGroupSuggestion = {
  capability_area_name: string;
  capability_area_description: string | null;
  subject_names: string[];
};

export type CapabilityAreaGroupingAiResult = {
  groups: CapabilityAreaGroupSuggestion[];
  possible_duplicates: {
    name_a: string;
    name_b: string;
    note: string | null;
  }[];
  activity_style_subjects: { name: string; note: string | null }[];
};

export async function analyzeCapabilityAreaGrouping(input: {
  companyProfile: OrganisationProfileRow | null;
  subjects: {
    id: string;
    name: string;
    description: string | null;
    governance_status?: string | null;
    current_capability_area_name?: string | null;
  }[];
  capabilityAreaAnchors?: { name: string; governance_status?: string | null }[];
  mode: "bottom_up" | "top_down";
  predefinedAreaNames?: string[];
}): Promise<CapabilityAreaGroupingAiResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in to run analysis. Your session may have expired."
    );
  }
  const body: Record<string, unknown> = {
    companyProfile: toMinimalCompanyProfilePayload(input.companyProfile),
    subjects: input.subjects,
    mode: input.mode,
  };
  if (input.capabilityAreaAnchors?.length) {
    body.capabilityAreaAnchors = input.capabilityAreaAnchors;
  }
  if (input.mode === "top_down" && input.predefinedAreaNames?.length) {
    body.predefinedAreaNames = input.predefinedAreaNames;
  }
  const { data, error } = await supabase.functions.invoke(
    "group-capability-areas",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
    }
  );
  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from group-capability-areas.");
  }
  const o = data as Record<string, unknown>;
  const groups = o.groups;
  if (!Array.isArray(groups)) {
    throw new Error("Response missing groups array.");
  }
  return data as CapabilityAreaGroupingAiResult;
}

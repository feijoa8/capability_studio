import { supabase } from "./supabase";
import { normalizeHrLineKey } from "./jobProfileHrSuggestions";
import { toHierarchyCompanyProfilePayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";

export type JobProfileSkillSuggestionInput = {
  companyProfile: OrganisationProfileRow | null;
  jobTitle: string;
  levelName: string | null;
  familyName: string | null;
  roleSummary: string | null;
  responsibilities: string[];
  requirements: string[];
  existingSkillNames: string[];
};

/** Structured skill suggestion: capabilities vs tooling (stored in one DB list on apply — see JobProfilesSection). */
export type JobProfileSkillSuggestionResult = {
  core_skills: string[];
  tools_and_platforms: string[];
};

function normalizeStringArrayDeduped(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function parseResult(data: unknown): JobProfileSkillSuggestionResult {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from skill suggestion service.");
  }
  const o = data as Record<string, unknown>;
  let core_skills = normalizeStringArrayDeduped(o.core_skills);
  let tools_and_platforms = normalizeStringArrayDeduped(o.tools_and_platforms);
  const legacy = normalizeStringArrayDeduped(o.suggested_skills);
  if (core_skills.length === 0 && tools_and_platforms.length === 0 && legacy.length > 0) {
    core_skills = legacy;
  }
  return { core_skills, tools_and_platforms };
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
 * Calls Edge Function `suggest-job-profile-skills` (OpenAI server-side).
 * Returns core capabilities and tools/platforms separately; apply merges into `job_profile_skills.name` for now.
 */
export async function suggestJobProfileSkills(
  input: JobProfileSkillSuggestionInput,
): Promise<JobProfileSkillSuggestionResult> {
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
    "suggest-job-profile-skills",
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
          role_summary: input.roleSummary,
          responsibilities: input.responsibilities,
          requirements: input.requirements,
          existing_skill_names: input.existingSkillNames,
        },
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  return parseResult(data);
}

export function normalizeSkillNameKey(name: string): string {
  return normalizeHrLineKey(name);
}

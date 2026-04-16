import { supabase } from "./supabase";
import { toHierarchyCompanyProfilePayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";

export type GeneratedSubjectDraft = {
  name: string;
  description: string;
  category: string | null;
};

export type GeneratedCompetencyDraft = {
  name: string;
  description: string;
};

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
      /* keep msg */
    }
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) msg = e.trim();
  }
  return msg;
}

export type GenerateSubjectsPracticeInput = {
  companyProfile: OrganisationProfileRow | null;
  practiceName: string;
  practiceDescription: string | null;
  existingSubjectNames: string[];
  /** Stable taxonomy anchors — passed to the model as non-duplicable names. */
  settledSubjectNames?: string[];
  protectedSubjectNames?: string[];
};

export type GenerateSubjectsOrganisationInput = {
  companyProfile: OrganisationProfileRow | null;
  /** When true, the edge function generates organisation-wide subjects (no practice scope). */
  organisationContext: true;
  existingSubjectNames: string[];
  settledSubjectNames?: string[];
  protectedSubjectNames?: string[];
};

export async function generateSubjectsWithAi(
  input: GenerateSubjectsPracticeInput | GenerateSubjectsOrganisationInput
): Promise<{ subjects: GeneratedSubjectDraft[] }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in to generate subjects. Your session may have expired."
    );
  }
  const settledSubjectNames = input.settledSubjectNames?.filter(Boolean) ?? [];
  const protectedSubjectNames =
    input.protectedSubjectNames?.filter(Boolean) ?? [];

  const body =
    "organisationContext" in input && input.organisationContext
      ? {
          companyProfile: toHierarchyCompanyProfilePayload(input.companyProfile),
          organisationContext: true as const,
          existingSubjectNames: input.existingSubjectNames,
          settledSubjectNames,
          protectedSubjectNames,
        }
      : {
          companyProfile: toHierarchyCompanyProfilePayload(
            (input as GenerateSubjectsPracticeInput).companyProfile
          ),
          practiceName: (input as GenerateSubjectsPracticeInput).practiceName.trim(),
          practiceDescription:
            (input as GenerateSubjectsPracticeInput).practiceDescription?.trim() ||
            null,
          existingSubjectNames: input.existingSubjectNames,
          settledSubjectNames,
          protectedSubjectNames,
        };
  const { data, error } = await supabase.functions.invoke("generate-subjects", {
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from generate-subjects.");
  }
  const o = data as Record<string, unknown>;
  const arr = o.subjects;
  if (!Array.isArray(arr)) {
    throw new Error("Response missing subjects array.");
  }
  const subjects: GeneratedSubjectDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const description =
      typeof row.description === "string" ? row.description.trim() : "";
    const categoryRaw = row.category;
    const category =
      typeof categoryRaw === "string" && categoryRaw.trim()
        ? categoryRaw.trim()
        : null;
    if (name) subjects.push({ name, description, category });
  }
  if (subjects.length === 0) {
    throw new Error("No subjects returned.");
  }
  return { subjects };
}

export async function generateCompetenciesWithAi(input: {
  companyProfile: OrganisationProfileRow | null;
  practiceName: string | null;
  subjectName: string;
  subjectDescription: string | null;
  existingCompetencyNames: string[];
}): Promise<{ competencies: GeneratedCompetencyDraft[] }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in to generate competencies. Your session may have expired."
    );
  }
  const { data, error } = await supabase.functions.invoke(
    "generate-competencies",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        companyProfile: toHierarchyCompanyProfilePayload(input.companyProfile),
        practiceName: input.practiceName?.trim() || null,
        subjectName: input.subjectName.trim(),
        subjectDescription: input.subjectDescription?.trim() || null,
        existingCompetencyNames: input.existingCompetencyNames,
      },
    }
  );
  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from generate-competencies.");
  }
  const o = data as Record<string, unknown>;
  const arr = o.competencies;
  if (!Array.isArray(arr)) {
    throw new Error("Response missing competencies array.");
  }
  const competencies: GeneratedCompetencyDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const description =
      typeof row.description === "string" ? row.description.trim() : "";
    if (name) competencies.push({ name, description });
  }
  if (competencies.length === 0) {
    throw new Error("No competencies returned.");
  }
  return { competencies };
}

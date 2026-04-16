import { supabase } from "./supabase";
import { toHierarchyCompanyProfilePayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";

export type GenerateCompetenciesFromSubjectsDepth =
  | "light"
  | "moderate"
  | "comprehensive";

export type GeneratedSubjectCompetenciesBlock = {
  name: string;
  competencies: string[];
  warning?: string;
};

export type GenerateCompetenciesFromSubjectsResult = {
  subjects: GeneratedSubjectCompetenciesBlock[];
};

function normKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
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
      /* keep */
    }
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) msg = e.trim();
  }
  return msg;
}

function dedupeLabelsInOrder(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) continue;
    const k = normKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Calls Edge Function `generate-competencies-from-subjects`.
 * Trims labels, drops empties, de-duplicates within each subject (case-insensitive), preserves subject order from the response.
 */
export async function generateCompetenciesFromSubjects(input: {
  companyProfile: OrganisationProfileRow | null;
  subjects: string[];
  depth: GenerateCompetenciesFromSubjectsDepth;
}): Promise<GenerateCompetenciesFromSubjectsResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in. Your session may have expired — sign in again.",
    );
  }

  const subjectNames = input.subjects
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean);

  if (subjectNames.length === 0) {
    throw new Error("Select at least one subject with a name.");
  }

  const { data, error } = await supabase.functions.invoke(
    "generate-competencies-from-subjects",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        companyProfile: toHierarchyCompanyProfilePayload(input.companyProfile),
        subjects: subjectNames,
        depth: input.depth,
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from generate-competencies-from-subjects.");
  }

  const raw = data as Record<string, unknown>;
  const arr = raw.subjects;
  if (!Array.isArray(arr)) {
    throw new Error('Response missing "subjects" array.');
  }

  const subjects: GeneratedSubjectCompetenciesBlock[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    const compsRaw = row.competencies;
    const labels: string[] = [];
    if (Array.isArray(compsRaw)) {
      for (const c of compsRaw) {
        if (typeof c === "string" && c.trim()) labels.push(c.trim());
      }
    }
    const warning =
      typeof row.warning === "string" && row.warning.trim()
        ? row.warning.trim()
        : undefined;
    subjects.push({
      name,
      competencies: dedupeLabelsInOrder(labels),
      ...(warning ? { warning } : {}),
    });
  }

  return { subjects };
}

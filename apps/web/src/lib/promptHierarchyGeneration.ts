import { supabase } from "./supabase";

export type PromptHierarchyCompetency = {
  name: string;
  description?: string;
};

export type PromptHierarchySubject = {
  name: string;
  description?: string;
  competencies: PromptHierarchyCompetency[];
};

export type PromptHierarchyPractice = {
  name: string;
  description?: string;
  subjects: PromptHierarchySubject[];
};

export type PromptHierarchyResult = {
  practices: PromptHierarchyPractice[];
};

/** Optional taxonomy anchors for generate-hierarchy-from-prompt (governance). */
export type PromptHierarchyTaxonomyAnchors = {
  protectedSubjectNames?: string[];
  settledSubjectNames?: string[];
  protectedCapabilityAreaNames?: string[];
  settledCapabilityAreaNames?: string[];
  protectedPracticeNames?: string[];
  settledPracticeNames?: string[];
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

function parseResult(data: unknown): PromptHierarchyResult {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from generate-hierarchy-from-prompt.");
  }
  const o = data as Record<string, unknown>;
  const arr = o.practices;
  if (!Array.isArray(arr)) {
    throw new Error("Response missing practices array.");
  }
  const practices: PromptHierarchyPractice[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    const description =
      typeof row.description === "string" ? row.description.trim() : undefined;
    const subjectsRaw = row.subjects;
    const subjects: PromptHierarchySubject[] = [];
    if (Array.isArray(subjectsRaw)) {
      for (const s of subjectsRaw) {
        if (!s || typeof s !== "object") continue;
        const sr = s as Record<string, unknown>;
        const sn = typeof sr.name === "string" ? sr.name.trim() : "";
        if (!sn) continue;
        const sd =
          typeof sr.description === "string" ? sr.description.trim() : undefined;
        const compRaw = sr.competencies;
        const competencies: PromptHierarchyCompetency[] = [];
        if (Array.isArray(compRaw)) {
          for (const c of compRaw) {
            if (!c || typeof c !== "object") continue;
            const cr = c as Record<string, unknown>;
            const cn = typeof cr.name === "string" ? cr.name.trim() : "";
            if (!cn) continue;
            const cd =
              typeof cr.description === "string"
                ? cr.description.trim()
                : undefined;
            competencies.push({ name: cn, description: cd });
          }
        }
        subjects.push({ name: sn, description: sd, competencies });
      }
    }
    practices.push({ name, description, subjects });
  }
  if (practices.length === 0) {
    throw new Error("No practices returned.");
  }
  return { practices };
}

export async function generateHierarchyFromPrompt(input: {
  prompt: string;
  taxonomyAnchors?: PromptHierarchyTaxonomyAnchors;
}): Promise<PromptHierarchyResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in to generate suggestions. Your session may have expired — sign in again.",
    );
  }

  const { data, error } = await supabase.functions.invoke(
    "generate-hierarchy-from-prompt",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: {
        prompt: input.prompt.trim(),
        ...(input.taxonomyAnchors &&
        Object.values(input.taxonomyAnchors).some(
          (v) => Array.isArray(v) && v.length > 0,
        )
          ? { taxonomyAnchors: input.taxonomyAnchors }
          : {}),
      },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  return parseResult(data);
}

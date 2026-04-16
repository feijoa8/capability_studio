import { supabase } from "./supabase";

export type CompanyProfileResearchSuggestions = {
  /** Organisation overview from research (1–3 sentences). */
  summary: string | null;
  /** Short directional strategic statement; complements key_drivers. */
  strategic_focus: string | null;
  key_drivers: string[];
  delivery_models: string[];
  organisation_structure: string | null;
  primary_capability_areas: string[];
  regulatory_intensity: string | null;
  role_model_bias: string | null;
  capability_focus_notes: string | null;
  rationale: string | null;
};

export type CompanyProfileResearchResult = {
  suggestions: CompanyProfileResearchSuggestions;
  sources: {
    homepage: string;
    about_page: string | null;
  };
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
      /* keep */
    }
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) msg = e.trim();
  }
  return msg;
}

/**
 * Fetches public website content via ScrapingBee (server-side) and returns
 * AI-suggested profile fields only — never persists.
 */
export async function researchCompanyProfileFromUrl(
  url: string,
): Promise<CompanyProfileResearchResult> {
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
    "research-company-profile-url",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: { url: url.trim() },
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from company research service.");
  }

  const o = data as Record<string, unknown>;
  if (typeof o.error === "string" && o.error.trim() && !o.suggestions) {
    throw new Error(o.error.trim());
  }

  const suggestions = o.suggestions;
  if (!suggestions || typeof suggestions !== "object") {
    throw new Error("Response missing suggestions.");
  }

  const s = suggestions as Record<string, unknown>;
  const normStr = (x: unknown): string | null => {
    if (typeof x !== "string") return null;
    const t = x.trim();
    return t ? t : null;
  };
  const normArr = (x: unknown): string[] =>
    Array.isArray(x)
      ? x.filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
      : [];

  const sourcesRaw = o.sources;
  const sources =
    sourcesRaw && typeof sourcesRaw === "object" && !Array.isArray(sourcesRaw)
      ? (sourcesRaw as Record<string, unknown>)
      : {};

  return {
    suggestions: {
      summary: normStr(s.summary),
      strategic_focus: normStr(s.strategic_focus),
      key_drivers: normArr(s.key_drivers),
      delivery_models: normArr(s.delivery_models),
      organisation_structure: normStr(s.organisation_structure),
      primary_capability_areas: normArr(s.primary_capability_areas),
      regulatory_intensity: normStr(s.regulatory_intensity),
      role_model_bias: normStr(s.role_model_bias),
      capability_focus_notes: normStr(s.capability_focus_notes),
      rationale: normStr(s.rationale),
    },
    sources: {
      homepage:
        typeof sources.homepage === "string" && sources.homepage.trim()
          ? sources.homepage.trim()
          : url.trim(),
      about_page:
        typeof sources.about_page === "string" && sources.about_page.trim()
          ? sources.about_page.trim()
          : null,
    },
  };
}

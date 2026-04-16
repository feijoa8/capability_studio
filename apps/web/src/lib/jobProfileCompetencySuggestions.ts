import { supabase } from "./supabase";
import { toSuggestJobProfileCompanyExtendedPayload } from "./organisationProfileMaps";
import type { OrganisationProfileRow } from "../pages/hub/types";
import type { CompetencyRow } from "../pages/hub/types";
import type { SubjectPracticeLinkRow } from "../pages/hub/subjectPracticeLinks";
import type { JobProfileCompetencyRelevance } from "../pages/hub/types";
import type { CompetencyLevelDefinitionRow } from "../pages/hub/types";
import { practiceIdsForSubjectDisplay } from "../pages/hub/subjectPracticeLinks";

/** Raw AI line (core / supporting) from the edge function. */
export type JobProfileCompetencyAiLine = {
  competency_name: string;
  recommended_level: string;
  relevance: JobProfileCompetencyRelevance;
  required: boolean;
  reason: string;
  /** Legacy keys from older model output (ignored if canonical fields present). */
  suggested_required_level?: string;
  suggested_relevance?: JobProfileCompetencyRelevance;
  suggested_required_flag?: boolean;
};

export type JobProfileCompetencyAiSubjectGroup = {
  subject_name: string;
  competencies: JobProfileCompetencyAiLine[];
};

export type JobProfileCompetencyAiGaps = {
  missing_competencies: {
    name: string;
    suggested_subject: string;
    reason: string;
  }[];
  missing_subjects: {
    name: string;
    suggested_capability_area: string;
    reason: string;
  }[];
};

export type JobProfileCompetencyAiResult = {
  core: JobProfileCompetencyAiSubjectGroup[];
  supporting: JobProfileCompetencyAiSubjectGroup[];
  gaps: JobProfileCompetencyAiGaps;
};

/** One resolved competency line in the AI review table (before apply). */
export type CompetencySuggestionReviewRow = {
  key: string;
  /** Distinguishes Core vs Supporting sections in the UI. */
  tier: "core" | "supporting";
  subjectId: string;
  subjectName: string;
  competencyId: string;
  competencyName: string;
  levelOptions: CompetencyLevelDefinitionRow[];
  requiredLevel: string;
  relevance: JobProfileCompetencyRelevance;
  isRequired: boolean;
  reason: string;
  selected: boolean;
};

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
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

export async function suggestJobProfileCompetencies(
  body: Record<string, unknown>,
): Promise<JobProfileCompetencyAiResult> {
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
    "suggest-job-profile-competencies",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body,
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from competency suggestion service.");
  }
  const raw = data as Record<string, unknown>;
  const gapsRaw = raw.gaps ?? raw.potential_taxonomy_gaps;
  let gaps: JobProfileCompetencyAiGaps =
    gapsRaw && typeof gapsRaw === "object" && !Array.isArray(gapsRaw)
      ? {
          missing_competencies: Array.isArray(
            (gapsRaw as JobProfileCompetencyAiGaps).missing_competencies,
          )
            ? (gapsRaw as JobProfileCompetencyAiGaps).missing_competencies
            : [],
          missing_subjects: Array.isArray(
            (gapsRaw as JobProfileCompetencyAiGaps).missing_subjects,
          )
            ? (gapsRaw as JobProfileCompetencyAiGaps).missing_subjects
            : [],
        }
      : { missing_competencies: [], missing_subjects: [] };

  /** Legacy edge output: map old gap keys into new shape (best-effort). */
  const gr = gapsRaw as Record<string, unknown> | null;
  if (
    gaps.missing_competencies.length === 0 &&
    gr &&
    Array.isArray(gr.missing_competency_suggestions)
  ) {
    gaps = {
      ...gaps,
      missing_competencies: (
        gr.missing_competency_suggestions as {
          description?: string;
          rationale?: string | null;
        }[]
      ).map((x) => ({
        name: typeof x.description === "string" ? x.description : "—",
        suggested_subject: "—",
        reason: typeof x.rationale === "string" ? x.rationale : "—",
      })),
    };
  }
  if (
    gaps.missing_subjects.length === 0 &&
    gr &&
    Array.isArray(gr.missing_subject_suggestions)
  ) {
    gaps = {
      ...gaps,
      missing_subjects: (
        gr.missing_subject_suggestions as {
          description?: string;
          rationale?: string | null;
        }[]
      ).map((x) => ({
        name: typeof x.description === "string" ? x.description : "—",
        suggested_capability_area: "—",
        reason: typeof x.rationale === "string" ? x.rationale : "—",
      })),
    };
  }

  let core = Array.isArray(raw.core)
    ? (raw.core as JobProfileCompetencyAiResult["core"])
    : [];
  let supporting = Array.isArray(raw.supporting)
    ? (raw.supporting as JobProfileCompetencyAiResult["supporting"])
    : [];
  if (
    core.length === 0 &&
    supporting.length === 0 &&
    Array.isArray(raw.suggestions_by_subject)
  ) {
    core = raw.suggestions_by_subject as JobProfileCompetencyAiResult["core"];
  }

  return {
    core,
    supporting,
    gaps,
  };
}

type SubjectRow = {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  practice_id: string | null;
  capability_area_id: string | null;
  governance_status: string | null;
  /** PostgREST may return a single row or a one-element array for embedded FK */
  capability_areas:
    | { id: string; name: string; governance_status: string | null }
    | { id: string; name: string; governance_status: string | null }[]
    | null;
};

/** Loads governance + capability area labels for subjects (org-scoped). */
export async function fetchSubjectsAndCapabilityAreasForSuggestions(
  organisationId: string,
): Promise<{
  capability_areas: {
    id: string;
    name: string;
    governance_status: string | null;
  }[];
  subjects: SubjectRow[];
}> {
  const [areasRes, subjRes] = await Promise.all([
    supabase
      .from("capability_areas")
      .select("id, name, governance_status")
      .eq("organisation_id", organisationId)
      .order("name"),
    supabase
      .from("competency_subjects")
      .select(
        "id, name, description, type, practice_id, capability_area_id, governance_status, capability_areas ( id, name, governance_status )",
      )
      .eq("organisation_id", organisationId)
      .order("name"),
  ]);

  if (areasRes.error) console.error(areasRes.error);
  if (subjRes.error) console.error(subjRes.error);

  const capability_areas =
    (areasRes.data as {
      id: string;
      name: string;
      governance_status: string | null;
    }[]) ?? [];

  const subjects = (subjRes.data as unknown as SubjectRow[]) ?? [];

  return { capability_areas, subjects };
}

function subjectEmbedFromCompetency(
  row: CompetencyRow,
): { id: string; name: string; type?: string | null; practice_id?: string | null } | null {
  const raw = row.competency_subjects;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function buildSubjectPracticeNotes(
  subjects: SubjectRow[],
  links: SubjectPracticeLinkRow[],
  practicesById: Map<string, string>,
): string[] {
  const notes: string[] = [];
  for (const s of subjects) {
    const ids = practiceIdsForSubjectDisplay(links, s.id, s.practice_id);
    const labels = ids
      .map((id) => practicesById.get(id) ?? id)
      .filter(Boolean);
    const gov = (s.governance_status ?? "draft").trim() || "draft";
    const ca = s.capability_areas;
    const areaRow = Array.isArray(ca) ? ca[0] : ca;
    const areaName = areaRow?.name ?? null;
    const head = `Subject "${s.name}" [governance: ${gov}; capability area: ${areaName ?? "—"}]`;
    if (labels.length > 0) {
      notes.push(`${head} — practice context: ${labels.join(", ")}`);
    } else {
      notes.push(`${head} — practice context: (none linked)`);
    }
  }
  return notes;
}

/** Build request body for the edge function from in-memory picker data + enriched subjects. */
export function buildCompetencySuggestionRequest(params: {
  companyProfile: OrganisationProfileRow | null;
  jobTitle: string;
  levelName: string | null;
  jobFamilyName: string | null;
  roleSummary: string | null;
  responsibilities: string[];
  requirements: string[];
  existingCompetencyNames: string[];
  mappingCompetencyOptions: CompetencyRow[];
  capability_areas: { id: string; name: string; governance_status: string | null }[];
  subjects: SubjectRow[];
  subjectPracticeLinks: SubjectPracticeLinkRow[];
  practiceOptions: { id: string; name: string }[];
  levelNamesByCompetencyId: Record<string, string[]>;
  /** Optional: practice-overlay-first role build + augmentation (edge prompt). */
  roleCapabilityCalibration?: string | null;
  primaryPracticeName?: string | null;
  augmentationGuidance?: string | null;
  competencyNamesFromPrimaryPractice?: string[];
}): Record<string, unknown> {
  const practicesById = new Map(
    params.practiceOptions.map((p) => [p.id, p.name] as const),
  );

  const subjectById = new Map(params.subjects.map((s) => [s.id, s] as const));

  const taxonomySubjects = params.subjects.map((s) => {
    const ids = practiceIdsForSubjectDisplay(
      params.subjectPracticeLinks,
      s.id,
      s.practice_id,
    );
    const practice_labels = ids
      .map((id) => practicesById.get(id) ?? id)
      .filter(Boolean);
    const ca = s.capability_areas;
    const area = Array.isArray(ca) ? ca[0] : ca;
    return {
      id: s.id,
      name: s.name,
      description: s.description?.trim() || null,
      type: s.type ?? null,
      governance_status: s.governance_status ?? null,
      capability_area_name: area?.name ?? null,
      practice_labels,
    };
  });

  const taxonomyCompetencies = params.mappingCompetencyOptions.map((c) => {
    const sub = c.subject_id ? subjectById.get(c.subject_id) : undefined;
    const emb = subjectEmbedFromCompetency(c);
    const subject_name = sub?.name ?? emb?.name ?? null;
    const level_names = params.levelNamesByCompetencyId[c.id] ?? [];
    return {
      id: c.id,
      name: c.name,
      description: c.description?.trim() || null,
      subject_id: c.subject_id ?? null,
      subject_name,
      status: c.status ?? null,
      level_names,
    };
  });

  const subject_practice_notes = buildSubjectPracticeNotes(
    params.subjects,
    params.subjectPracticeLinks,
    practicesById,
  );

  const jobProfile: Record<string, unknown> = {
    title: params.jobTitle,
    level: params.levelName,
    job_family: params.jobFamilyName,
    role_summary: params.roleSummary,
    responsibilities: params.responsibilities,
    requirements: params.requirements,
    existing_competency_names: params.existingCompetencyNames,
  };
  if (params.roleCapabilityCalibration?.trim()) {
    jobProfile.role_capability_calibration =
      params.roleCapabilityCalibration.trim();
  }
  if (params.primaryPracticeName?.trim()) {
    jobProfile.primary_practice_name = params.primaryPracticeName.trim();
  }
  if (params.augmentationGuidance?.trim()) {
    jobProfile.augmentation_guidance = params.augmentationGuidance.trim();
  }
  if (
    params.competencyNamesFromPrimaryPractice &&
    params.competencyNamesFromPrimaryPractice.length > 0
  ) {
    jobProfile.competency_names_from_primary_practice =
      params.competencyNamesFromPrimaryPractice.map((n) => n.trim()).filter(
        Boolean,
      );
  }

  return {
    companyProfile: toSuggestJobProfileCompanyExtendedPayload(
      params.companyProfile,
    ),
    jobProfile,
    taxonomy: {
      capability_areas: params.capability_areas.map((a) => ({
        id: a.id,
        name: a.name,
        governance_status: a.governance_status ?? null,
      })),
      subjects: taxonomySubjects,
      competencies: taxonomyCompetencies,
      subject_practice_notes,
    },
  };
}

export async function fetchLevelNamesByCompetencyIds(
  competencyIds: string[],
): Promise<Record<string, string[]>> {
  if (competencyIds.length === 0) return {};
  const res = await supabase
    .from("competency_level_definitions")
    .select("competency_id, level_name, level_order")
    .in("competency_id", competencyIds)
    .eq("is_active", true)
    .order("level_order", { ascending: true });

  if (res.error) {
    console.error(res.error);
    return {};
  }
  const rows =
    (res.data as {
      competency_id: string;
      level_name: string;
      level_order: number;
    }[]) ?? [];
  const by: Record<string, string[]> = {};
  for (const r of rows) {
    if (!by[r.competency_id]) by[r.competency_id] = [];
    by[r.competency_id].push(r.level_name);
  }
  return by;
}

export async function fetchLevelDefinitionsForCompetencyIds(
  competencyIds: string[],
): Promise<Record<string, CompetencyLevelDefinitionRow[]>> {
  if (competencyIds.length === 0) return {};
  const res = await supabase
    .from("competency_level_definitions")
    .select(
      "id, competency_id, level_name, level_order, description, is_active",
    )
    .in("competency_id", competencyIds)
    .eq("is_active", true)
    .order("level_order", { ascending: true });

  if (res.error) {
    console.error(res.error);
    return {};
  }
  const rows = (res.data as CompetencyLevelDefinitionRow[]) ?? [];
  const by: Record<string, CompetencyLevelDefinitionRow[]> = {};
  for (const r of rows) {
    if (!by[r.competency_id]) by[r.competency_id] = [];
    by[r.competency_id].push(r);
  }
  return by;
}

export function snapRequiredLevel(
  suggested: string,
  defs: CompetencyLevelDefinitionRow[],
): string {
  if (defs.length === 0) return suggested.trim();
  const t = suggested.trim().toLowerCase();
  const exact = defs.find((d) => d.level_name.toLowerCase() === t);
  if (exact) return exact.level_name;
  const partial = defs.find(
    (d) =>
      t.includes(d.level_name.toLowerCase()) ||
      d.level_name.toLowerCase().includes(t),
  );
  if (partial) return partial.level_name;
  const mid = Math.min(defs.length - 1, Math.max(0, Math.floor(defs.length / 2)));
  return defs[mid]!.level_name;
}

function lineRecommendedLevel(line: {
  recommended_level?: string;
  suggested_required_level?: string;
}): string {
  if (typeof line.recommended_level === "string" && line.recommended_level.trim()) {
    return line.recommended_level.trim();
  }
  if (
    typeof line.suggested_required_level === "string" &&
    line.suggested_required_level.trim()
  ) {
    return line.suggested_required_level.trim();
  }
  return "";
}

function lineRelevance(line: {
  relevance?: string;
  suggested_relevance?: string;
}): JobProfileCompetencyRelevance {
  const rel = line.relevance ?? line.suggested_relevance;
  return rel === "low" || rel === "medium" || rel === "high" ? rel : "medium";
}

function lineRequired(line: {
  required?: boolean;
  suggested_required_flag?: boolean;
}): boolean {
  if (typeof line.required === "boolean") return line.required;
  return Boolean(line.suggested_required_flag);
}

/**
 * Map AI core + supporting groups + catalogue to review rows.
 * Duplicate competency IDs across tiers: core wins.
 */
export function resolveAiSuggestionsToReviewRows(
  ai: JobProfileCompetencyAiResult,
  subjectNameToId: Map<string, string>,
  competencies: CompetencyRow[],
): CompetencySuggestionReviewRow[] {
  const compByNorm = new Map<string, CompetencyRow[]>();
  for (const c of competencies) {
    const k = normKey(c.name);
    const list = compByNorm.get(k) ?? [];
    list.push(c);
    compByNorm.set(k, list);
  }

  function resolveTier(
    groups: JobProfileCompetencyAiSubjectGroup[],
    tier: "core" | "supporting",
  ): CompetencySuggestionReviewRow[] {
    const rows: CompetencySuggestionReviewRow[] = [];
    let seq = 0;
    for (const group of groups) {
      const sid = subjectNameToId.get(normKey(group.subject_name));
      if (!sid) continue;

      for (const line of group.competencies) {
        const candidates =
          compByNorm.get(normKey(line.competency_name)) ?? [];
        const match = candidates.find((c) => c.subject_id === sid);
        if (!match) continue;

        seq += 1;
        rows.push({
          key: `ai-${tier}-${match.id}-${seq}`,
          tier,
          subjectId: sid,
          subjectName: group.subject_name.trim(),
          competencyId: match.id,
          competencyName: match.name,
          levelOptions: [],
          requiredLevel: lineRecommendedLevel(line),
          relevance: lineRelevance(line),
          isRequired: lineRequired(line),
          reason:
            typeof line.reason === "string" ? line.reason.trim() : "",
          selected: true,
        });
      }
    }
    return rows;
  }

  const coreRows = resolveTier(ai.core ?? [], "core");
  const supportingRows = resolveTier(ai.supporting ?? [], "supporting");
  const seen = new Set<string>();
  const out: CompetencySuggestionReviewRow[] = [];
  for (const r of coreRows) {
    if (seen.has(r.competencyId)) continue;
    seen.add(r.competencyId);
    out.push(r);
  }
  for (const r of supportingRows) {
    if (seen.has(r.competencyId)) continue;
    seen.add(r.competencyId);
    out.push(r);
  }
  return out;
}

/** Group resolved rows by subject name for one tier (stable sort). */
export function groupCompetencyAiRowsBySubject(
  rows: CompetencySuggestionReviewRow[],
  tier: "core" | "supporting",
): [string, CompetencySuggestionReviewRow[]][] {
  const map = new Map<string, CompetencySuggestionReviewRow[]>();
  for (const r of rows) {
    if (r.tier !== tier) continue;
    const list = map.get(r.subjectName) ?? [];
    list.push(r);
    map.set(r.subjectName, list);
  }
  return [...map.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: "base" }),
  );
}

export function buildSubjectNameToIdMap(
  subjects: SubjectRow[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of subjects) {
    m.set(normKey(s.name), s.id);
  }
  return m;
}

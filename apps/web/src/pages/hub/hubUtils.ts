import type {
  JobFamilyRow,
  JobProfileRow,
  JobProfileCompetencyMappingRow,
  JobProfileCompetencyRelevance,
} from "./types";
import { parseLifecycleStatus } from "./competencyLifecycle";

function parseRelevance(
  raw: string | null | undefined
): JobProfileCompetencyRelevance {
  const v = (raw ?? "medium").toLowerCase();
  if (v === "low" || v === "high") return v;
  return "medium";
}

export function normalizeJobProfileCompetencyRows(
  data: unknown
): JobProfileCompetencyMappingRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as {
      id: string;
      job_profile_id?: string;
      competency_id: string;
      required_level: string | null;
      is_required: boolean;
      relevance?: string | null;
      competencies?:
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
    };
    const c = row.competencies;
    const comp = Array.isArray(c) ? (c[0] ?? null) : (c ?? null);
    const nameFromJoin =
      comp && typeof comp === "object" && "name" in comp
        ? (comp as { name?: string }).name
        : undefined;
    const statusFromJoin =
      comp && typeof comp === "object" && "status" in comp
        ? (comp as { status?: string }).status
        : undefined;
    const competency_name =
      typeof nameFromJoin === "string" &&
      nameFromJoin.trim().length > 0
        ? nameFromJoin.trim()
        : "Unknown competency";
    return {
      id: row.id,
      job_profile_id: row.job_profile_id ?? "",
      competency_id: row.competency_id,
      required_level: row.required_level,
      is_required: row.is_required,
      relevance: parseRelevance(row.relevance),
      competency_name,
      competency_status: parseLifecycleStatus(statusFromJoin),
    };
  });
}

export function organisationLabel(m: {
  organisations?: { name?: string } | null;
}): string {
  const name = m.organisations?.name?.trim();
  if (name) return name;
  return "Organisation";
}

export const UNCATEGORISED_HEADING = "Uncategorised";

export function normalizeJobProfileLevelName(levelTrimmed: string): string {
  return levelTrimmed.startsWith("Level")
    ? levelTrimmed
    : `Level ${levelTrimmed}`;
}

export function uncategorisedJobProfiles(
  profiles: JobProfileRow[],
  families: JobFamilyRow[]
): JobProfileRow[] {
  const ids = new Set(families.map((f) => f.id));
  return profiles.filter(
    (p) => p.job_family_id == null || !ids.has(p.job_family_id)
  );
}

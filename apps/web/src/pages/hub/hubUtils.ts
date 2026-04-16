import type {
  CompetencySubjectRow,
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
        | {
            id: string;
            name: string;
            description?: string | null;
            subject_id?: string | null;
            competency_subjects?:
              | CompetencySubjectRow
              | CompetencySubjectRow[]
              | null;
          }
        | {
            id: string;
            name: string;
            description?: string | null;
            subject_id?: string | null;
            competency_subjects?:
              | CompetencySubjectRow
              | CompetencySubjectRow[]
              | null;
          }[]
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
    const descriptionFromJoin =
      comp && typeof comp === "object" && "description" in comp
        ? (comp as { description?: string | null }).description
        : undefined;
    const subjectIdFromComp =
      comp && typeof comp === "object" && "subject_id" in comp
        ? (comp as { subject_id?: string | null }).subject_id
        : undefined;
    const subEmbedRaw =
      comp && typeof comp === "object" && "competency_subjects" in comp
        ? (comp as { competency_subjects?: CompetencySubjectRow | CompetencySubjectRow[] | null })
            .competency_subjects
        : undefined;
    const subEmbed = Array.isArray(subEmbedRaw)
      ? subEmbedRaw[0] ?? null
      : subEmbedRaw ?? null;
    const subject_id: string | null =
      (typeof subEmbed?.id === "string" ? subEmbed.id : null) ??
      (typeof subjectIdFromComp === "string" ? subjectIdFromComp : null) ??
      null;
    const subject_name =
      typeof subEmbed?.name === "string" && subEmbed.name.trim()
        ? subEmbed.name.trim()
        : null;
    const subject_type =
      typeof subEmbed?.type === "string" ? subEmbed.type : null;
    const subject_practice_id =
      subEmbed && "practice_id" in subEmbed
        ? subEmbed.practice_id ?? null
        : null;
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
      competency_description:
        typeof descriptionFromJoin === "string" &&
        descriptionFromJoin.trim().length > 0
          ? descriptionFromJoin.trim()
          : null,
      subject_id,
      subject_name,
      subject_type,
      subject_practice_id,
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

export function fullNameFromProfile(p: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  return p.email?.trim() || "Member";
}

export function formatWorkspaceRole(role: string | null | undefined): string {
  const r = role?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = {
    company_owner: "Company owner",
    company_admin: "Company admin",
    company_it_admin: "IT admin",
    learning_lead: "Learning lead",
    member: "Member",
    admin: "Admin",
  };
  return map[r] ?? (r ? r.replace(/_/g, " ") : "—");
}

export function profileFirstName(p: {
  first_name?: string | null;
  display_name?: string | null;
  email?: string | null;
}): string {
  const fn = p.first_name?.trim();
  if (fn) return fn;
  const dn = p.display_name?.trim();
  if (dn) {
    const part = dn.split(/\s+/)[0];
    if (part) return part;
  }
  const em = p.email?.trim();
  if (em) return em.split("@")[0] || "Member";
  return "Member";
}

export function profileInitials(p: {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  email?: string | null;
}): string {
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  if (fn && ln) return (fn[0]! + ln[0]!).toUpperCase();
  const dn = (p.display_name ?? "").trim();
  if (dn) {
    const parts = dn.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    }
    if (parts.length === 1 && parts[0]!.length >= 2) {
      return parts[0]!.slice(0, 2).toUpperCase();
    }
    if (parts.length === 1) return parts[0]![0]!.toUpperCase();
  }
  const em = (p.email ?? "").trim();
  if (em.length >= 2) return em.slice(0, 2).toUpperCase();
  return "?";
}

import type { UserExperienceProject, UserExperienceRow } from "./types";
import { normalizeSkillLabel } from "./skillNormalization";

/** Default “Top skills” slice for summary UIs. */
export const PERSONAL_EVIDENCE_SKILL_TOP_N = 12;

type TagArrayRoleKey = "skills" | "methods" | "tools";
type TagArrayProjectKey = "skills" | "methods" | "tools";

function roleTagArray(
  e: UserExperienceRow,
  field: TagArrayRoleKey,
): unknown[] {
  const v = e[field];
  return Array.isArray(v) ? v : [];
}

function projectTagArray(
  p: UserExperienceProject,
  field: TagArrayProjectKey,
): unknown[] {
  const v = p[field];
  return Array.isArray(v) ? v : [];
}

function wordCountLabel(label: string): number {
  return label.trim().split(/\s+/).filter(Boolean).length;
}

function aggregateTagArraysFromEvidence(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
  roleField: TagArrayRoleKey,
  projectField: TagArrayProjectKey,
): { label: string; count: number }[] {
  const byKey = new Map<string, { label: string; count: number }>();
  const bump = (raw: unknown) => {
    const label = normalizeSkillLabel(String(raw));
    if (!label) return;
    const k = label.toLowerCase();
    const cur = byKey.get(k);
    if (cur) cur.count += 1;
    else byKey.set(k, { label, count: 1 });
  };
  for (const e of experiences) {
    for (const t of roleTagArray(e, roleField)) bump(t);
  }
  for (const p of projects) {
    for (const t of projectTagArray(p, projectField)) bump(t);
  }
  return [...byKey.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const wc = wordCountLabel(b.label) - wordCountLabel(a.label);
    if (wc !== 0) return wc;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

/**
 * Skill tag counts from saved work experience and projects (CV import and manual entry).
 */
export function aggregateSkillsFromEvidence(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): { label: string; count: number }[] {
  return aggregateTagArraysFromEvidence(experiences, projects, "skills", "skills");
}

/** Methods / practices tag counts (evidence-linked). */
export function aggregateMethodsFromEvidence(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): { label: string; count: number }[] {
  return aggregateTagArraysFromEvidence(experiences, projects, "methods", "methods");
}

/** Tools / platforms tag counts (evidence-linked). */
export function aggregateToolsFromEvidence(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): { label: string; count: number }[] {
  return aggregateTagArraysFromEvidence(experiences, projects, "tools", "tools");
}

/**
 * Industry label counts from role and project rows.
 */
export function aggregateIndustriesFromEvidence(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): { label: string; count: number }[] {
  const byKey = new Map<string, { label: string; count: number }>();
  const bump = (raw: string | null | undefined) => {
    const ind = raw?.trim();
    if (!ind) return;
    const k = ind.toLowerCase();
    const cur = byKey.get(k);
    if (cur) cur.count += 1;
    else byKey.set(k, { label: ind, count: 1 });
  };
  for (const e of experiences) bump(e.industry);
  for (const p of projects) bump(p.industry);
  return [...byKey.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const wc = wordCountLabel(b.label) - wordCountLabel(a.label);
    if (wc !== 0) return wc;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

/** Heuristic for future AI refinement: role may need richer evidence tags. */
export type ExperienceEvidenceRichness = {
  experienceId: string;
  skillMentions: number;
  methodMentions: number;
  toolMentions: number;
  totalTagMentions: number;
  isUnderDescribed: boolean;
  reasons: string[];
};

/**
 * Flags experience rows that have sparse skills/methods/tools (role + its projects).
 * Safe to call from refinement prep; does not persist anything.
 */
export function assessExperienceEvidenceRichness(
  experience: UserExperienceRow,
  projectsForExperience: UserExperienceProject[],
): ExperienceEvidenceRichness {
  const countField = (
    row: UserExperienceRow | UserExperienceProject,
    key: TagArrayRoleKey,
  ): number => {
    const v = row[key];
    return Array.isArray(v) ? v.length : 0;
  };

  let skillMentions = countField(experience, "skills");
  let methodMentions = countField(experience, "methods");
  let toolMentions = countField(experience, "tools");

  for (const p of projectsForExperience) {
    skillMentions += countField(p, "skills");
    methodMentions += countField(p, "methods");
    toolMentions += countField(p, "tools");
  }

  const totalTagMentions = skillMentions + methodMentions + toolMentions;
  const reasons: string[] = [];
  let isUnderDescribed = false;

  if (totalTagMentions < 4) {
    isUnderDescribed = true;
    reasons.push("few evidence tags across role and projects");
  }
  if (skillMentions < 2 && methodMentions === 0 && toolMentions === 0) {
    isUnderDescribed = true;
    reasons.push("almost no skills and no methods or tools");
  }
  if (methodMentions === 0 && toolMentions === 0 && skillMentions > 0) {
    reasons.push("methods and tools both empty");
  }

  return {
    experienceId: experience.id,
    skillMentions,
    methodMentions,
    toolMentions,
    totalTagMentions,
    isUnderDescribed,
    reasons,
  };
}

/** Single place a skill or industry string appears in saved evidence (role or project). */
export type EvidenceWhere = {
  kind: "role" | "project";
  experienceId: string;
  projectId?: string;
  /** Short label for UI (role · org, or project · parent). */
  caption: string;
};

export type EvidenceTagDetail = {
  label: string;
  mentionCount: number;
  where: EvidenceWhere[];
};

function roleCaption(e: UserExperienceRow): string {
  const rt = e.role_title?.trim() || "Role";
  const org = e.organisation_name?.trim();
  return org ? `${rt} · ${org}` : rt;
}

function sortWhere(a: EvidenceWhere, b: EvidenceWhere): number {
  return a.caption.localeCompare(b.caption, undefined, { sensitivity: "base" });
}

function buildArrayFieldEvidenceDetails(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
  roleField: TagArrayRoleKey,
  projectField: TagArrayProjectKey,
): Map<string, EvidenceTagDetail> {
  type Bucket = {
    label: string;
    mentionCount: number;
    sources: Map<string, EvidenceWhere>;
  };
  const byKey = new Map<string, Bucket>();

  const addTag = (raw: unknown, where: EvidenceWhere) => {
    const label = normalizeSkillLabel(String(raw));
    if (!label) return;
    const k = label.toLowerCase();
    let b = byKey.get(k);
    if (!b) {
      b = { label, mentionCount: 0, sources: new Map() };
      byKey.set(k, b);
    }
    b.mentionCount += 1;
    const srcKey =
      where.kind === "role"
        ? `role:${where.experienceId}`
        : `project:${where.projectId ?? where.experienceId}`;
    if (!b.sources.has(srcKey)) b.sources.set(srcKey, where);
  };

  for (const e of experiences) {
    const cap = roleCaption(e);
    for (const t of roleTagArray(e, roleField)) {
      addTag(t, { kind: "role", experienceId: e.id, caption: cap });
    }
  }
  for (const p of projects) {
    const exp = experiences.find((x) => x.id === p.experience_id);
    const parentCap = exp ? roleCaption(exp) : "Role";
    const projCap = `${p.project_name?.trim() || "Project"} · ${parentCap}`;
    for (const t of projectTagArray(p, projectField)) {
      addTag(t, {
        kind: "project",
        experienceId: p.experience_id,
        projectId: p.id,
        caption: projCap,
      });
    }
  }

  const out = new Map<string, EvidenceTagDetail>();
  for (const [k, b] of byKey) {
    out.set(k, {
      label: b.label,
      mentionCount: b.mentionCount,
      where: [...b.sources.values()].sort(sortWhere),
    });
  }
  return out;
}

/**
 * Per normalized skill key: total tag mentions and unique role/project sources.
 * Matches {@link aggregateSkillsFromEvidence} mention counts.
 */
export function buildSkillEvidenceDetails(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): Map<string, EvidenceTagDetail> {
  return buildArrayFieldEvidenceDetails(
    experiences,
    projects,
    "skills",
    "skills",
  );
}

/** Provenance map for methods/practices tags. */
export function buildMethodEvidenceDetails(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): Map<string, EvidenceTagDetail> {
  return buildArrayFieldEvidenceDetails(
    experiences,
    projects,
    "methods",
    "methods",
  );
}

/** Provenance map for tools/platforms tags. */
export function buildToolEvidenceDetails(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): Map<string, EvidenceTagDetail> {
  return buildArrayFieldEvidenceDetails(
    experiences,
    projects,
    "tools",
    "tools",
  );
}

/**
 * Per normalized industry key: rows that carry that industry label on role or project.
 * Matches {@link aggregateIndustriesFromEvidence} counts (one per row with a label).
 */
export function buildIndustryEvidenceDetails(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
): Map<string, EvidenceTagDetail> {
  type Bucket = {
    label: string;
    mentionCount: number;
    sources: Map<string, EvidenceWhere>;
  };
  const byKey = new Map<string, Bucket>();

  const addRow = (raw: string | null | undefined, where: EvidenceWhere) => {
    const ind = raw?.trim();
    if (!ind) return;
    const k = ind.toLowerCase();
    let b = byKey.get(k);
    if (!b) {
      b = { label: ind, mentionCount: 0, sources: new Map() };
      byKey.set(k, b);
    }
    b.mentionCount += 1;
    const srcKey =
      where.kind === "role"
        ? `role:${where.experienceId}`
        : `project:${where.projectId}`;
    if (!b.sources.has(srcKey)) b.sources.set(srcKey, where);
  };

  for (const e of experiences) {
    if (!e.industry?.trim()) continue;
    addRow(e.industry, { kind: "role", experienceId: e.id, caption: roleCaption(e) });
  }
  for (const p of projects) {
    if (!p.industry?.trim()) continue;
    const exp = experiences.find((x) => x.id === p.experience_id);
    const parentCap = exp ? roleCaption(exp) : "Role";
    addRow(p.industry, {
      kind: "project",
      experienceId: p.experience_id,
      projectId: p.id,
      caption: `${p.project_name?.trim() || "Project"} · ${parentCap}`,
    });
  }

  const out = new Map<string, EvidenceTagDetail>();
  for (const [k, b] of byKey) {
    out.set(k, {
      label: b.label,
      mentionCount: b.mentionCount,
      where: [...b.sources.values()].sort(sortWhere),
    });
  }
  return out;
}

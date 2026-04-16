import {
  aggregateIndustriesFromEvidence,
  aggregateMethodsFromEvidence,
  aggregateSkillsFromEvidence,
  aggregateToolsFromEvidence,
  assessExperienceEvidenceRichness,
  PERSONAL_EVIDENCE_SKILL_TOP_N,
} from "./personalEvidenceDerivation";
import type { UserExperienceProject, UserExperienceRow } from "./types";

/** Best-effort “current role” line from saved experience (no workspace job profile). */
export function inferCurrentRoleFromExperiences(
  experiences: UserExperienceRow[],
): string | null {
  if (experiences.length === 0) return null;
  const currentFlagged = experiences.filter((e) => e.is_current);
  const pool = currentFlagged.length > 0 ? currentFlagged : experiences;
  const sorted = [...pool].sort((a, b) => {
    const ao = a.sort_order ?? 0;
    const bo = b.sort_order ?? 0;
    if (ao !== bo) return ao - bo;
    return String(b.end_date ?? "").localeCompare(String(a.end_date ?? ""));
  });
  const e = sorted[0]!;
  const rt = e.role_title?.trim() || "Role";
  const org = e.organisation_name?.trim();
  return org ? `${rt} · ${org}` : rt;
}

export type PersonalCareerEvidenceSnapshot = {
  experienceCount: number;
  projectCount: number;
  qualificationCount: number;
  certificationCount: number;
  topSkills: { label: string; count: number }[];
  topMethods: { label: string; count: number }[];
  topTools: { label: string; count: number }[];
  topIndustries: { label: string; count: number }[];
  /** Short evidence-grounded copy; no AI claims. */
  domainSummary: string | null;
  strengthLines: string[];
  gapHints: string[];
};

/**
 * Read-only snapshot for Individual My Career — derived from profile + experience + projects + counts.
 */
export function buildPersonalCareerEvidenceSnapshot(
  experiences: UserExperienceRow[],
  projects: UserExperienceProject[],
  qualificationCount: number,
  certificationCount: number,
): PersonalCareerEvidenceSnapshot {
  const skills = aggregateSkillsFromEvidence(experiences, projects);
  const methods = aggregateMethodsFromEvidence(experiences, projects);
  const tools = aggregateToolsFromEvidence(experiences, projects);
  const industries = aggregateIndustriesFromEvidence(experiences, projects);

  const topSkills = skills.slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N);
  const topMethods = methods.slice(0, 8);
  const topTools = tools.slice(0, 8);
  const topIndustries = industries.slice(0, 6);

  const domainSummary = (() => {
    if (topIndustries.length === 0) return null;
    const names = topIndustries.map((i) => i.label);
    if (names.length <= 3) {
      return `Your saved roles and projects reference these industry or domain labels: ${names.join(", ")}.`;
    }
    return `Your evidence spans several domain labels (top ones: ${names
      .slice(0, 3)
      .join(", ")} and others).`;
  })();

  const strengthLines: string[] = [];
  for (const s of skills.slice(0, 5)) {
    if (s.count >= 2) {
      strengthLines.push(
        `${s.label} — shows up across ${s.count} mentions in your saved evidence (roles and projects).`,
      );
    } else if (skills.length > 0 && strengthLines.length < 3) {
      strengthLines.push(
        `${s.label} — recorded in your experience; adding related projects can strengthen this thread.`,
      );
    }
  }

  const gapHintsSet = new Set<string>();
  const projectsByExp = new Map<string, UserExperienceProject[]>();
  for (const p of projects) {
    const list = projectsByExp.get(p.experience_id) ?? [];
    list.push(p);
    projectsByExp.set(p.experience_id, list);
  }
  for (const e of experiences) {
    const rich = assessExperienceEvidenceRichness(
      e,
      projectsByExp.get(e.id) ?? [],
    );
    if (rich.isUnderDescribed) {
      gapHintsSet.add(
        `“${e.role_title?.trim() || "Role"}”: ${rich.reasons[0] ?? "consider adding methods, tools, or richer project evidence"}.`,
      );
    }
  }
  if (
    experiences.length > 0 &&
    methods.length === 0 &&
    tools.length === 0 &&
    gapHintsSet.size === 0
  ) {
    gapHintsSet.add(
      "Methods and tools are empty across your roles — adding how you work (practices and platforms) makes this career view more useful.",
    );
  }
  if (experiences.length === 0) {
    gapHintsSet.add(
      "Add at least one role in My Experience so this page can summarize your career from evidence.",
    );
  }

  return {
    experienceCount: experiences.length,
    projectCount: projects.length,
    qualificationCount,
    certificationCount,
    topSkills,
    topMethods,
    topTools,
    topIndustries,
    domainSummary,
    strengthLines: strengthLines.slice(0, 5),
    gapHints: [...gapHintsSet].slice(0, 4),
  };
}

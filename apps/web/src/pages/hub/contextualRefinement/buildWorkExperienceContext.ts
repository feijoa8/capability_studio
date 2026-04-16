import type { UserExperienceProject, UserExperienceRow } from "../types";
import { REFINEMENT_MODES, type RefinementContext } from "./types";

const MAX_PROJECT_DESC_CHARS = 800;
const MAX_PROJECTS = 12;

function truncate(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

function missingHintsForExperience(
  row: UserExperienceRow,
  projects: UserExperienceProject[],
): string[] {
  const hints: string[] = [];
  if (!row.description?.trim()) hints.push("description_empty");
  if (!(row.skills?.length ?? 0)) hints.push("skills_empty");
  if (!(row.methods?.length ?? 0)) hints.push("methods_empty");
  if (!(row.tools?.length ?? 0)) hints.push("tools_empty");
  if (!row.industry?.trim()) hints.push("industry_empty");
  if (projects.length === 0) hints.push("no_projects_linked");
  return hints;
}

/**
 * Build a versioned, bounded {@link RefinementContext} for one work experience row.
 */
export function buildWorkExperienceRefinementContext(args: {
  experience: UserExperienceRow;
  relatedProjects: UserExperienceProject[];
  mode?: typeof REFINEMENT_MODES.REFINE_EXPERIENCE | typeof REFINEMENT_MODES.DERIVE_TAGS;
  account?: { primaryAccountType?: string | null };
  client?: string;
}): RefinementContext {
  const mode =
    args.mode ?? REFINEMENT_MODES.REFINE_EXPERIENCE;
  const projects = args.relatedProjects.slice(0, MAX_PROJECTS).map((p) => ({
    id: p.id,
    project_name: p.project_name?.trim() ?? null,
    description: truncate(p.description, MAX_PROJECT_DESC_CHARS),
    industry: p.industry?.trim() ?? null,
    skills: [...(p.skills ?? [])].map(String),
    methods: [...(p.methods ?? [])].map(String),
    tools: [...(p.tools ?? [])].map(String),
  }));

  const payload = {
    role_title: args.experience.role_title?.trim() ?? "",
    organisation_name: args.experience.organisation_name?.trim() ?? "",
    description: args.experience.description?.trim() || null,
    start_date: args.experience.start_date ?? null,
    end_date: args.experience.end_date ?? null,
    is_current: Boolean(args.experience.is_current),
    industry: args.experience.industry?.trim() || null,
    skills: [...(args.experience.skills ?? [])].map(String),
    methods: [...(args.experience.methods ?? [])].map(String),
    tools: [...(args.experience.tools ?? [])].map(String),
    related_projects: projects,
    missingFieldHints: missingHintsForExperience(
      args.experience,
      args.relatedProjects,
    ),
  };

  const base = {
    schemaVersion: 1 as const,
    account: args.account,
    meta: {
      requestedAt: new Date().toISOString(),
      client: args.client,
    },
  };

  if (mode === REFINEMENT_MODES.DERIVE_TAGS) {
    return {
      ...base,
      mode: REFINEMENT_MODES.DERIVE_TAGS,
      entityType: "work_experience",
      entityId: args.experience.id,
      payload,
    };
  }

  return {
    ...base,
    mode: REFINEMENT_MODES.REFINE_EXPERIENCE,
    entityType: "work_experience",
    entityId: args.experience.id,
    payload,
  };
}

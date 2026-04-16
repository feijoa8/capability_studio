import type { CareerRefinementContext } from "./types";
import type { PersonalCareerEvidenceSnapshot } from "../personalCareerSnapshot";

function truncate(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

function trimArray(items: string[], max: number): string[] {
  return items.map((x) => x.trim()).filter(Boolean).slice(0, max);
}

/**
 * Build a bounded context for the AI Career Coach (Personal Account).
 * This context is intentionally compact: it contains summary signals only.
 */
export function buildCareerRefinementContext(args: {
  profileSummary: string | null;
  currentRoleLine: string | null;
  careerVision: {
    nextRole: string;
    nextRoleHorizon: string;
    futureRole: string;
    futureRoleHorizon: string;
  };
  careerNotes: string;
  evidenceSnapshot: PersonalCareerEvidenceSnapshot;
  client?: string;
}): CareerRefinementContext {
  return {
    schemaVersion: 1,
    entityType: "career_plan",
    entityId: null,
    meta: {
      requestedAt: new Date().toISOString(),
      client: args.client,
    },
    payload: {
      profile_summary: truncate(args.profileSummary, 900),
      current_role: truncate(args.currentRoleLine, 120),
      career_vision: {
        next_role: truncate(args.careerVision.nextRole, 80),
        next_role_horizon: truncate(args.careerVision.nextRoleHorizon, 40),
        future_role: truncate(args.careerVision.futureRole, 80),
        future_role_horizon: truncate(args.careerVision.futureRoleHorizon, 40),
      },
      career_notes: truncate(args.careerNotes, 900),
      evidence_snapshot: {
        experience_count: args.evidenceSnapshot.experienceCount,
        project_count: args.evidenceSnapshot.projectCount,
        qualification_count: args.evidenceSnapshot.qualificationCount,
        certification_count: args.evidenceSnapshot.certificationCount,
        top_skills: trimArray(
          args.evidenceSnapshot.topSkills.map((s) => s.label),
          12,
        ),
        top_methods: trimArray(
          args.evidenceSnapshot.topMethods.map((m) => m.label),
          10,
        ),
        top_tools: trimArray(args.evidenceSnapshot.topTools.map((t) => t.label), 10),
        top_industries: trimArray(
          args.evidenceSnapshot.topIndustries.map((i) => i.label),
          8,
        ),
      },
      strengths: trimArray(args.evidenceSnapshot.strengthLines, 8),
      gaps: trimArray(args.evidenceSnapshot.gapHints, 8),
    },
  };
}


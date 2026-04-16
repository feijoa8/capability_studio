/**
 * Contextual AI refiner — contracts only (no chat history, no agent orchestration).
 *
 * Principles:
 * - AI does not create truth: outputs are {@link RefinementSuggestionPayload} for human review.
 * - Context is bounded JSON sent to a future edge/API route, not whole app state.
 * - Four evidence categories stay separate: Skills, Methods, Tools, Industries (domain).
 *
 * Production path: `supabase/functions/refine-evidence` accepts {@link RefinementContext}
 * and returns {@link RefinementSuggestionPayload}; {@link WorkExperienceRefinerModal} invokes
 * it and uses `onApplySuggestions` to prefill the edit form (no auto-save).
 *
 * No DB migration required for contracts; optional future table for audit logs only.
 */

/** Modes the refiner can run in; extend as new surfaces are added. */
export const REFINEMENT_MODES = {
  REFINE_EXPERIENCE: "refine_experience",
  DERIVE_TAGS: "derive_tags",
  IMPROVE_PROFILE: "improve_profile",
  STRENGTHEN_COMPETENCIES: "strengthen_competencies",
} as const;

export type RefinementMode =
  (typeof REFINEMENT_MODES)[keyof typeof REFINEMENT_MODES];

export type RefinementEntityType =
  | "work_experience"
  | "work_experience_project"
  | "user_profile"
  | "competency_record"
  | "career_plan"
  | "application";

export type RefinementConfidence = "low" | "medium" | "high";

/** Optional per-category confidence for review UI. */
export type CategoryConfidence = Partial<
  Record<
    "skills" | "methods" | "tools" | "industry" | "summary",
    RefinementConfidence
  >
>;

export interface RefinementFollowUpQuestion {
  id: string;
  question: string;
  /** If true, user can apply suggestions without answering. */
  optional: boolean;
}

export interface RefinementAccountContext {
  primaryAccountType?: string | null;
}

/**
 * Bounded payload for refining a single work experience row (+ optional projects).
 * Maps to `user_experience` / `user_experience_projects` fields.
 */
export interface WorkExperienceRefinementPayload {
  role_title: string;
  organisation_name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  industry: string | null;
  skills: string[];
  methods: string[];
  tools: string[];
  /** Truncated project snippets under this role (evidence context only). */
  related_projects: Array<{
    id: string;
    project_name: string | null;
    description: string | null;
    industry: string | null;
    skills: string[];
    methods: string[];
    tools: string[];
  }>;
  /** Heuristic hints for the model (e.g. "description_empty"); not user-facing copy. */
  missingFieldHints: string[];
}

export interface RefinementContextBase {
  schemaVersion: 1;
  account?: RefinementAccountContext;
  meta: {
    requestedAt: string;
    /** Optional client identifier for logging. */
    client?: string;
  };
}

/** Discriminated context: add union members for profile/competency/etc. later. */
export type RefinementContext = RefinementContextBase &
  (
    | {
        mode: typeof REFINEMENT_MODES.REFINE_EXPERIENCE;
        entityType: "work_experience";
        entityId: string;
        payload: WorkExperienceRefinementPayload;
      }
    | {
        mode: typeof REFINEMENT_MODES.DERIVE_TAGS;
        entityType: "work_experience";
        entityId: string;
        payload: WorkExperienceRefinementPayload;
      }
    | {
        mode: typeof REFINEMENT_MODES.IMPROVE_PROFILE;
        entityType: "user_profile";
        entityId: string | null;
        /** Placeholder until profile payload is defined. */
        payload: Record<string, unknown>;
      }
    | {
        mode: typeof REFINEMENT_MODES.STRENGTHEN_COMPETENCIES;
        entityType: "competency_record";
        entityId: string | null;
        payload: Record<string, unknown>;
      }
  );

/**
 * Structured suggestion returned by the refiner (future API).
 * Parent merges into forms only after explicit user confirmation.
 */
export interface RefinementSuggestionPayload {
  schemaVersion: 1;
  mode: RefinementMode;
  entityType: RefinementEntityType;
  entityId: string | null;
  suggestedDescription: string | null;
  suggestedSkills: string[];
  suggestedMethods: string[];
  suggestedTools: string[];
  suggestedIndustry: string | null;
  followUpQuestions: RefinementFollowUpQuestion[];
  rationale: string | null;
  categoryConfidence: CategoryConfidence | null;
}

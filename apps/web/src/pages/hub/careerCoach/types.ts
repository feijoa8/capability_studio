/**
 * AI Career Coach — bounded context in, structured focus areas out.
 * Mirrors the "refine-evidence" pattern: review-only until explicit Apply.
 */

export type CareerRefinementContext = {
  schemaVersion: 1;
  entityType: "career_plan";
  /** Optional for personal accounts (null); org career plans can pass org id later. */
  entityId: string | null;
  meta: {
    requestedAt: string;
    client?: string;
  };
  payload: {
    profile_summary: string | null;
    current_role: string | null;
    career_vision: {
      next_role: string | null;
      next_role_horizon: string | null;
      future_role: string | null;
      future_role_horizon: string | null;
    };
    career_notes: string | null;
    evidence_snapshot: {
      experience_count: number;
      project_count: number;
      qualification_count: number;
      certification_count: number;
      top_skills: string[];
      top_methods: string[];
      top_tools: string[];
      top_industries: string[];
    };
    strengths: string[];
    gaps: string[];
  };
};

export type CareerFocusArea = {
  title: string;
  description: string;
  rationale: string;
  related_signals: {
    skills?: string[];
    methods?: string[];
    tools?: string[];
    industries?: string[];
  };
  confidence?: number;
};

export type CareerFocusSuggestionPayload = {
  focus_areas: CareerFocusArea[];
  follow_ups?: string[];
};


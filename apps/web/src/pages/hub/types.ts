import type { CompetencyLifecycleStatus } from "./competencyLifecycle";

/** Row from `profiles` (extends with app-specific columns after migration) */
export type ProfileRow = {
  id: string;
  email?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  summary?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedin_url?: string | null;
};

export type WorkspaceMembership = {
  id: string;
  organisation_id: string;
  workspace_role: string;
  membership_status: string;
  organisations: { id: string; name: string } | null;
};

export type UserExperienceRow = {
  id: string;
  user_id: string;
  role_title: string | null;
  organisation_name: string | null;
  description: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
  industry?: string | null;
  /** Canonical skill tags for this role (text[]); aligns with user_experience_projects.skills */
  skills?: string[] | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

/** Enduring qualifications (degrees, courses, non-renewable credentials) — org-scoped */
export type UserQualificationRow = {
  id: string;
  organisation_id: string;
  user_id: string;
  title: string;
  issuer: string | null;
  qualification_type: string | null;
  date_achieved: string | null;
  notes: string | null;
  credential_url: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Renewable certifications (safety, compliance, expiring credentials) — org-scoped */
export type UserCertificationRow = {
  id: string;
  organisation_id: string;
  user_id: string;
  title: string;
  issuer: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  renewal_required: boolean;
  notes: string | null;
  credential_url: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Optional project-level rows under a work experience entry (schema only until UI ships) */
export type UserExperienceProject = {
  id: string;
  experience_id: string;
  user_id: string;
  project_name?: string | null;
  client?: string | null;
  role?: string | null;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  skills?: string[] | null;
  industry?: string | null;
  created_at: string;
  updated_at: string;
};

export type JobProfileRow = {
  id: string;
  title: string;
  level_name: string | null;
  is_active: boolean;
  job_family_id: string | null;
  /** Organisation-grounded role narrative; optional AI-refined summary */
  role_summary?: string | null;
};

export type JobFamilyRow = {
  id: string;
  name: string;
  is_active: boolean;
};

/** Top-level grouping for subjects within an organisation (e.g. clinical area, capability area) */
export type CompetencyPracticeRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  organisation_id?: string;
  status?: CompetencyLifecycleStatus;
  deprecated_at?: string | null;
  deprecated_reason?: string | null;
  replaced_by_id?: string | null;
};

/** How the competency is positioned for development (orthogonal to Practice → Subject hierarchy) */
export type CompetencyType = "practice" | "organisation" | "stretch";

/** Parent group for competencies (Practice, Organisation, etc.) */
export type CompetencySubjectRow = {
  id: string;
  name: string;
  description: string | null;
  /** practice | organisation | stretch — aligns with competency_type */
  type?: string | null;
  category: string | null;
  /** Optional link to a practice; null = "Unassigned Practice" in the UI */
  practice_id?: string | null;
  competency_practices?: CompetencyPracticeRow | CompetencyPracticeRow[] | null;
  status?: CompetencyLifecycleStatus;
  deprecated_at?: string | null;
  deprecated_reason?: string | null;
  replaced_by_id?: string | null;
};

export type CompetencyRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  competency_type?: CompetencyType;
  subject_id?: string | null;
  /** Populated when loading with a join to competency_subjects (array from PostgREST embed) */
  competency_subjects?: CompetencySubjectRow | CompetencySubjectRow[] | null;
  status?: CompetencyLifecycleStatus;
  deprecated_at?: string | null;
  deprecated_reason?: string | null;
  replaced_by_id?: string | null;
};

export type CompetencyLevelDefinitionRow = {
  id: string;
  competency_id: string;
  level_name: string;
  level_order: number;
  description: string | null;
  is_active: boolean;
};

/** How important this competency is for the job profile (same competency can differ per role) */
export type JobProfileCompetencyRelevance = "low" | "medium" | "high";

export type JobProfileCompetencyMappingRow = {
  id: string;
  job_profile_id: string;
  competency_id: string;
  required_level: string | null;
  is_required: boolean;
  relevance: JobProfileCompetencyRelevance;
  competency_name: string;
  /** Present when join loads `competencies.status` */
  competency_status?: CompetencyLifecycleStatus;
};

export type JobProfileResponsibilityRow = {
  id: string;
  job_profile_id: string;
  description: string;
  order_index: number;
  created_at: string;
};

export type JobProfileRequirementRow = {
  id: string;
  job_profile_id: string;
  description: string;
  order_index: number;
  created_at: string;
};

export type JobProfileSkillRow = {
  id: string;
  job_profile_id: string;
  name: string;
  created_at: string;
};

export type IndustryInsightCategory =
  | "industry"
  | "regulatory"
  | "legal"
  | "technology"
  | "market";

export type IndustryInsightStatus = "active" | "deprecated" | "archived";

export type IndustryInsightRow = {
  id: string;
  title: string;
  summary: string;
  category: IndustryInsightCategory;
  industry: string | null;
  region: string | null;
  tags: string[];
  source_url: string | null;
  status: IndustryInsightStatus;
  created_at: string;
  updated_at: string;
};

export type OrganisationInsightLinkRow = {
  id: string;
  organisation_id: string;
  insight_id: string;
  relevance_note: string | null;
  relevance_score: number | null;
  created_at: string;
};

export type AppSection =
  | "my_dashboard"
  | "my_profile"
  | "my_competencies"
  | "my_experience"
  | "my_career"
  | "my_development"
  | "my_team"
  | "team_insights"
  | "industry_insights"
  | "job_profiles"
  | "member_capability"
  | "competency_management"
  | "user_admin"
  | "teams"
  | "company_profile";

/** One row per organisation — workspace company context for UX / AI interpretation */
export type OrganisationProfileRow = {
  id: string;
  organisation_id: string;
  organisation_name: string | null;
  sector: string | null;
  industry: string | null;
  summary: string | null;
  business_purpose: string | null;
  strategic_priorities: string | null;
  delivery_context: string | null;
  capability_emphasis: string | null;
  role_interpretation_guidance: string | null;
  terminology_guidance: string | null;
  created_at: string;
  updated_at: string;
};

/** Workspace team (primary org grouping; not a reporting line) */
export type TeamRow = {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  manager_user_id: string | null;
  created_at: string;
  updated_at: string;
};

/** One primary team per user per organisation */
export type UserTeamAssignmentRow = {
  id: string;
  organisation_id: string;
  user_id: string;
  team_id: string;
  created_at: string;
};

/** One row per user per org: direct manager assignment */
export type UserReportingLineRow = {
  id: string;
  organisation_id: string;
  user_id: string;
  manager_user_id: string;
  created_at: string;
};

/** One row per user per workspace — future-focused career planning (My Career) */
export type UserCareerPlanRow = {
  id: string;
  user_id: string;
  organisation_id: string;
  next_role: string | null;
  next_role_horizon: string | null;
  future_role: string | null;
  future_role_horizon: string | null;
  career_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceBootstrapState = {
  memberships: WorkspaceMembership[];
  loading: boolean;
  loadError: string | null;
  activeOrgId: string | null;
};

export type DevelopmentGoalStatus =
  | "not_started"
  | "in_progress"
  | "completed";

/** Where the goal sits in personal / review planning (distinct from progress `status`). */
export type DevelopmentGoalLifecycleStatus =
  | "backlog"
  | "active"
  | "completed";

export type DevelopmentGoalRow = {
  id: string;
  organisation_id: string;
  user_id: string;
  competency_id: string | null;
  current_level: string;
  target_level: string;
  relevance: string;
  title: string;
  description: string | null;
  suggested_actions: string[];
  status: DevelopmentGoalStatus;
  progress: number;
  lifecycle_status: DevelopmentGoalLifecycleStatus;
  /** Stable id from career focus catalogue when saved from My Career backlog flow. */
  career_focus_source_id: string | null;
  created_at: string;
  updated_at: string;
  competencies?: { name: string } | { name: string }[] | null;
};

export type DevelopmentGoalNoteRow = {
  id: string;
  goal_id: string;
  note: string;
  progress_snapshot: number | null;
  created_at: string;
};

export type DevelopmentPlanType = "annual" | "quarterly" | "custom";

export type DevelopmentPlanStatus =
  | "draft"
  | "submitted"
  | "active"
  | "completed"
  | "archived";

export type DevelopmentPlanObjectivePriority = "low" | "medium" | "high";

export type DevelopmentPlanObjectiveStatus =
  | "not_started"
  | "in_progress"
  | "pending_manager_review"
  | "completed"
  | "blocked";

export type DevelopmentPlanRow = {
  id: string;
  organisation_id: string;
  user_id: string;
  manager_user_id: string | null;
  title: string;
  description: string | null;
  plan_type: DevelopmentPlanType;
  start_date: string | null;
  end_date: string | null;
  status: DevelopmentPlanStatus;
  employee_signed_at: string | null;
  manager_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DevelopmentPlanObjectiveRow = {
  id: string;
  development_plan_id: string;
  organisation_id: string;
  user_id: string;
  source_goal_id: string | null;
  competency_id: string | null;
  title: string;
  description: string | null;
  success_criteria: string | null;
  due_date: string | null;
  priority: DevelopmentPlanObjectivePriority;
  progress: number;
  status: DevelopmentPlanObjectiveStatus;
  created_at: string;
  updated_at: string;
};

export type DevelopmentPlanObjectiveNoteType =
  | "update"
  | "blocker"
  | "reflection"
  | "manager_comment";

export type DevelopmentPlanObjectiveNoteRow = {
  id: string;
  development_plan_objective_id: string;
  organisation_id: string;
  user_id: string;
  note_type: DevelopmentPlanObjectiveNoteType;
  content: string;
  created_at: string;
  updated_at: string;
};

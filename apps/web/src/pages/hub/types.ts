import type { CompetencyLifecycleStatus } from "./competencyLifecycle";
import type { TaxonomyGovernanceStatus } from "./taxonomyGovernance";

/** Row from `profiles` (extends with app-specific columns after migration) */
export type ProfileRow = {
  id: string;
  /** Platform role: `learning_consultant` after system admin approval (not org workspace_role). */
  system_role?: string | null;
  email?: string | null;
  /** Optional alternate email for recovery / continuity (not sign-in). */
  recovery_email?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  summary?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedin_url?: string | null;
  avatar_url?: string | null;
  /** `personal` | `organisation` — set via account setup; enables My Profile without a workspace. */
  primary_account_type?: string | null;
};

export type WorkspaceMembership = {
  id: string;
  organisation_id: string;
  workspace_role: string;
  /** Platform-level role (e.g. system_admin); independent of org workspace_role. */
  system_role?: string | null;
  /** `consultant` = external learning consultant; requires platform role + owner approval. */
  access_type?: string | null;
  /** For consultants: org owner must approve before org data is available. */
  approved_by_owner?: boolean | null;
  /** When multiple memberships exist for the same org, the UI uses the primary row. */
  is_primary?: boolean | null;
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
  /** Named practices / ways of working (Scrum, Design Thinking, …), evidence-linked */
  methods?: string[] | null;
  /** Named tools or platforms (Jira, Miro, …), evidence-linked */
  tools?: string[] | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
};

/** Enduring qualifications (degrees, courses, non-renewable credentials) — org-scoped or personal (null org) */
export type UserQualificationRow = {
  id: string;
  organisation_id: string | null;
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

/** Renewable certifications (safety, compliance, expiring credentials) — org-scoped or personal (null org) */
export type UserCertificationRow = {
  id: string;
  organisation_id: string | null;
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
  methods?: string[] | null;
  tools?: string[] | null;
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
  /** Optional alignment hint for practice refinement (e.g. BABOK v3, Scrum Guide 2020). */
  reference_framework?: string | null;
};

/** How the competency is positioned for development (orthogonal to Practice → Subject hierarchy) */
export type CompetencyType = "practice" | "organisation" | "stretch";

/** Primary visual grouping for subjects (non-exclusive of practice context). */
export type CapabilityAreaRow = {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  created_at?: string;
  /** draft | settled | protected — taxonomy governance (not lifecycle). */
  governance_status?: TaxonomyGovernanceStatus;
};

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
  /** Primary grouping layer for the competency catalogue UI */
  capability_area_id?: string | null;
  competency_practices?: CompetencyPracticeRow | CompetencyPracticeRow[] | null;
  status?: CompetencyLifecycleStatus;
  deprecated_at?: string | null;
  deprecated_reason?: string | null;
  replaced_by_id?: string | null;
  /** draft | settled | protected — taxonomy governance (orthogonal to lifecycle status). */
  governance_status?: TaxonomyGovernanceStatus;
  /** Traceability back to shared reference_subjects when adopted from the library. */
  reference_subject_id?: string | null;
  /** How this row was introduced (e.g. native vs reference_adopted). */
  origin_type?: string | null;
  /** Populated when loaded with `capability_areas` embed (catalogue queries). */
  capability_areas?:
    | { id: string; name: string }
    | { id: string; name: string }[]
    | null;
  /** Populated when loaded with `reference_subjects` embed (provenance). */
  reference_subjects?: unknown;
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
  /** Traceability back to shared reference_competencies when adopted. */
  reference_competency_id?: string | null;
  origin_type?: string | null;
  /** Normalised label from reference adoption; optional for native rows. */
  canonical_name?: string | null;
  /** Populated when loaded with `reference_competencies` embed (provenance). */
  reference_competencies?: unknown;
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
  /** Present when join loads `competencies.description` */
  competency_description?: string | null;
  /** Present when join loads `competencies.subject_id` / `competency_subjects` */
  subject_id?: string | null;
  subject_name?: string | null;
  subject_type?: string | null;
  subject_practice_id?: string | null;
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

/** AI extraction from a pasted job posting (matches edge function output). */
export type RoleAnalysisExtraction = {
  job_title: string | null;
  company: string | null;
  location: string | null;
  role_summary: string;
  key_competencies: string[];
  skills: string[];
  methods_practices: string[];
  tools_platforms: string[];
  industry_domain: string | null;
  watch_outs: string[];
  questions_to_ask: string[];
  key_role_signals: string[];
};

export type EvidenceSnapshotV1 = {
  schemaVersion: 1;
  work_experience: Array<{
    role_title: string | null;
    organisation_name: string | null;
    industry: string | null;
    skills: string[];
    methods: string[];
    tools: string[];
    description_excerpt: string | null;
  }>;
  projects: Array<{
    project_name: string | null;
    client: string | null;
    role: string | null;
    industry: string | null;
    skills: string[];
    methods: string[];
    tools: string[];
    description_excerpt: string | null;
  }>;
  qualifications: Array<{ name: string; issuer: string | null }>;
  certifications: Array<{ title: string; issuer: string | null }>;
};

export type JobEvidenceComparison = {
  match_score: number;
  summary: string;
  strengths: string[];
  partial_coverage: string[];
  gaps: string[];
  competency_summary: string;
};

export type ApplicationEvaluationStatus = "draft" | "ready";

export type ApplicationEvaluationRow = {
  id: string;
  user_id: string;
  status: ApplicationEvaluationStatus;
  title_hint: string | null;
  company_hint: string | null;
  source_url: string | null;
  raw_description: string;
  role_analysis: RoleAnalysisExtraction | Record<string, unknown>;
  evidence_snapshot: EvidenceSnapshotV1 | null;
  comparison_result: JobEvidenceComparison | null;
  created_at: string;
  updated_at: string;
};

export type AppSection =
  | "my_dashboard"
  | "my_competencies"
  | "my_experience"
  | "my_career"
  | "my_development"
  | "application_evaluations"
  | "my_team"
  | "team_insights"
  | "industry_insights"
  | "job_profiles"
  | "member_capability"
  | "competency_management"
  | "user_admin"
  | "teams"
  | "company_profile"
  | "starter_packs"
  | "system_reference_library"
  | "system_help_center";

/** One row per organisation — workspace company context for UX / AI interpretation */
export type OrganisationProfileRow = {
  id: string;
  organisation_id: string;
  organisation_name: string | null;
  sector: string | null;
  industry: string | null;
  /** Short snapshot; optional */
  summary: string | null;
  /** Legacy strategic narrative (mirrored from strategic_focus on save when using v2 UI). */
  business_purpose: string | null;
  /** Legacy (mirrored from key_drivers on save). */
  strategic_priorities: string | null;
  /** Legacy delivery narrative (mirrored from delivery_models on save). */
  delivery_context: string | null;
  /** Legacy capability emphasis (mirrored from primary_capability_areas on save). */
  capability_emphasis: string | null;
  role_interpretation_guidance: string | null;
  terminology_guidance: string | null;
  /** Optional public URL for assistive research only. */
  company_url: string | null;
  /** Primary strategy narrative (v2). */
  strategic_focus: string | null;
  key_drivers: string[] | null;
  delivery_models: string[] | null;
  organisation_structure: string | null;
  primary_capability_areas: string[] | null;
  capability_focus_notes: string | null;
  regulatory_intensity: string | null;
  role_model_bias: string | null;
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

/** One row per user per workspace (or personal standalone when `organisation_id` is null) */
export type UserCareerPlanRow = {
  id: string;
  user_id: string;
  organisation_id: string | null;
  next_role: string | null;
  next_role_horizon: string | null;
  future_role: string | null;
  future_role_horizon: string | null;
  career_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceBootstrapState = {
  /** Memberships that pass {@link membershipGrantsOrgData} — shell org picker & nav context. */
  memberships: WorkspaceMembership[];
  /**
   * All membership rows returned for the user (unfiltered). Used only for platform capabilities
   * that are not tied to a single org (e.g. reference library operator — any active WM with
   * `system_role = system_admin` plus domain pairing in DB).
   */
  allMembershipRows: WorkspaceMembership[];
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

export type DevelopmentFocusItemSource = "catalogue" | "ai" | "manual";

export type DevelopmentFocusItemStatus =
  | "backlog"
  | "in_progress"
  | "blocked"
  | "complete";

/** Personal-first backlog items (organisation_id null for Personal Account). */
export type DevelopmentFocusItemRow = {
  id: string;
  user_id: string;
  organisation_id: string | null;
  title: string;
  description: string | null;
  source: DevelopmentFocusItemSource;
  related_signals: Record<string, unknown>;
  status: DevelopmentFocusItemStatus;
  due_date?: string | null;
  archived?: boolean;
  created_at: string;
  updated_at: string;
};

export type DevelopmentFocusUpdateRow = {
  id: string;
  focus_item_id: string;
  user_id: string;
  note: string;
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

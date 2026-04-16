import type { AppSection } from "../pages/hub/types";

/** Maps dashboard section IDs to help `page_key` values (context mappings + articles). */
export const APP_SECTION_TO_PAGE_KEY: Partial<Record<AppSection, string>> = {
  my_dashboard: "dashboard",
  my_competencies: "my_competencies",
  my_experience: "my_experience",
  my_career: "my_career",
  my_development: "my_development",
  application_evaluations: "application_evaluations",
  my_team: "my_team",
  team_insights: "team_insights",
  industry_insights: "industry_insights",
  job_profiles: "job_profiles",
  member_capability: "member_capability",
  competency_management: "competency_management",
  user_admin: "user_admin",
  teams: "teams",
  company_profile: "company_profile",
  starter_packs: "starter_packs",
  system_reference_library: "system_reference_library",
  system_help_center: "system_help_center",
};

export function pageKeyFromAppSection(section: AppSection): string {
  return APP_SECTION_TO_PAGE_KEY[section] ?? "dashboard";
}

/** User-facing labels for help context (assistant + mappings), keyed by `page_key`. */
export const PAGE_CONTEXT_LABELS: Record<string, string> = {
  dashboard: "My Dashboard",
  my_competencies: "My Competencies",
  my_experience: "My Experience",
  my_career: "My Career",
  my_development: "My Development",
  application_evaluations: "Application Evaluations",
  my_team: "My Team",
  team_insights: "Team Insights",
  industry_insights: "Industry Insights",
  job_profiles: "Job Profiles",
  member_capability: "Member Capability",
  competency_management: "Competency Management",
  user_admin: "User Admin",
  teams: "Teams",
  company_profile: "Company Profile",
  starter_packs: "Starter packs",
  system_reference_library: "Reference library (system)",
  system_help_center: "Help Center (system)",
};

export function pageContextLabel(pageKey: string): string {
  return PAGE_CONTEXT_LABELS[pageKey] ?? pageKey.replace(/_/g, " ");
}

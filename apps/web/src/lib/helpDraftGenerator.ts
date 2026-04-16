/**
 * Scaffold for draft help content + change-queue proposals from app metadata.
 * Does not auto-publish — outputs are drafts for review or `help_change_queue` rows.
 */
import type { AppSection } from "../pages/hub/types";
import { APP_SECTION_TO_PAGE_KEY } from "./helpPageKeys";

export type HelpDraftArticleSeed = {
  slug: string;
  title: string;
  summary: string;
  body_markdown: string;
  article_type: string;
  audience: string;
  related_surface: "app" | "website" | "both";
  related_page_key: string | null;
  generated_from: string;
};

/** Major app surfaces for first-pass page guides (draft). */
export const HELP_SURFACE_METADATA: {
  section: AppSection;
  title: string;
  summary: string;
  bullets: string[];
}[] = [
  {
    section: "my_dashboard",
    title: "Personal dashboard",
    summary: "Overview of your role, goals, and organisation context.",
    bullets: ["Development goals", "Industry insights", "Quick navigation"],
  },
  {
    section: "my_competencies",
    title: "My Competencies",
    summary: "Assessments and gaps for your assigned job profile.",
    bullets: ["Proficiency levels", "Evidence", "Development goals"],
  },
  {
    section: "competency_management",
    title: "Competency Management",
    summary: "Organisation taxonomy: areas, subjects, competencies, practices.",
    bullets: ["Hierarchy", "Governance", "Archiving"],
  },
  {
    section: "member_capability",
    title: "Member Capability",
    summary: "Org-wide view of member capability and roles.",
    bullets: ["Teams", "Reporting", "Insights"],
  },
  {
    section: "starter_packs",
    title: "Starter packs",
    summary: "Adopt reference starter content into your organisation.",
    bullets: ["Browse published packs", "Adoption flow", "Traceability"],
  },
  {
    section: "system_reference_library",
    title: "System Reference Library",
    summary: "Platform reference frameworks and starter pack administration.",
    bullets: ["Frameworks", "Subjects", "Publishing"],
  },
  {
    section: "job_profiles",
    title: "Job Profiles",
    summary: "Define and maintain role profiles and competency expectations.",
    bullets: ["Role summaries", "Levels", "HR alignment"],
  },
  {
    section: "user_admin",
    title: "User Admin",
    summary: "Memberships, roles, and reporting lines.",
    bullets: ["Workspace roles", "Teams", "Managers"],
  },
  {
    section: "teams",
    title: "Teams",
    summary: "Organise people into teams for insights and reporting.",
    bullets: ["Membership", "Managers"],
  },
  {
    section: "company_profile",
    title: "Company Profile",
    summary: "Organisation narrative for AI and competency interpretation.",
    bullets: ["Strategy", "Terminology", "Industry"],
  },
];

export function buildDraftArticlesFromMetadata(): HelpDraftArticleSeed[] {
  return HELP_SURFACE_METADATA.map((m) => {
    const pageKey = APP_SECTION_TO_PAGE_KEY[m.section] ?? m.section;
    const body = [
      `# ${m.title}`,
      "",
      m.summary,
      "",
      "## In this area",
      ...m.bullets.map((b) => `- ${b}`),
      "",
      "_This page was scaffolded from app metadata; review before publishing._",
    ].join("\n");
    return {
      slug: `draft-${pageKey}`,
      title: m.title,
      summary: m.summary,
      body_markdown: body,
      article_type: "page_guide",
      audience: "all",
      related_surface: "app",
      related_page_key: pageKey,
      generated_from: "helpDraftGenerator.buildDraftArticlesFromMetadata",
    };
  });
}

/** Payload for `help_change_queue` when product metadata changes (manual trigger). */
export function proposeHelpChangeQueueRow(
  sourceKey: string,
  summary: string,
  draftPayload: Record<string, unknown>,
) {
  return {
    source_type: "metadata_refresh",
    source_key: sourceKey,
    detected_change_summary: summary,
    proposed_draft_payload: draftPayload,
    review_status: "pending" as const,
  };
}

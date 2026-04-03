import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import styles from "./MyDashboard.module.css";
import { useWorkspaceBootstrap } from "./DashboardSection";
import { PersonalDashboardSection } from "./PersonalDashboardSection";
import { MyProfileSection } from "./MyProfileSection";
import { JobProfilesSection } from "./JobProfilesSection";
import { CompetenciesSection } from "./CompetenciesSection";
import { MyCompetenciesSection } from "./MyCompetenciesSection";
import { MyExperienceSection } from "./MyExperienceSection";
import { MyCareerSection } from "./MyCareerSection";
import { MyDevelopmentSection } from "./MyDevelopmentSection";
import { MyTeamSection } from "./MyTeamSection";
import { TeamInsightsSection } from "./TeamInsightsSection";
import { UsersSection } from "./UsersSection";
import { UserAdminSection } from "./UserAdminSection";
import { TeamsSection } from "./TeamsSection";
import { CompanyProfileSection } from "./CompanyProfileSection";
import type { AppSection, WorkspaceBootstrapState } from "./hub/types";
import { organisationLabel } from "./hub/hubUtils";
import { canAccessWorkspaceManagementNav } from "./hub/workspaceRoles";
import {
  errorColor,
  muted,
  mutedColor,
  panelShell,
  text,
} from "./hub/hubTheme";

type Props = {
  userEmail: string;
};

const SECTION_LABELS: Record<AppSection, string> = {
  my_dashboard: "My Dashboard",
  my_profile: "My Profile",
  my_competencies: "My Competencies",
  my_experience: "My Experience",
  my_career: "My Career",
  my_development: "My Development",
  my_team: "My Team",
  team_insights: "Team Insights",
  job_profiles: "Job Profiles",
  member_capability: "Member Capability",
  competency_management: "Competency Management",
  user_admin: "User Admin",
  teams: "Teams",
  company_profile: "Company Profile",
};

const PERSONAL_NAV: { id: AppSection; label: string }[] = [
  { id: "my_dashboard", label: "My Dashboard" },
  { id: "my_profile", label: "My Profile" },
  { id: "my_competencies", label: "My Competencies" },
  { id: "my_experience", label: "My Experience" },
  { id: "my_career", label: "My Career" },
  { id: "my_development", label: "My Development" },
  { id: "my_team", label: "My Team" },
  { id: "team_insights", label: "Team Insights" },
];

const MANAGEMENT_NAV: { id: AppSection; label: string }[] = [
  { id: "job_profiles", label: "Job Profiles" },
  { id: "competency_management", label: "Competency Management" },
  { id: "member_capability", label: "Member Capability" },
];

const WORKSPACE_ADMIN_NAV: { id: AppSection; label: string }[] = [
  { id: "user_admin", label: "User Admin" },
  { id: "teams", label: "Teams" },
  { id: "company_profile", label: "Company Profile" },
];

/** Sections that require company admin or learning lead */
const ELEVATED_SECTION_IDS: AppSection[] = [
  "job_profiles",
  "competency_management",
  "member_capability",
  "user_admin",
  "teams",
  "company_profile",
];

function ManagementAccessRestricted() {
  return (
    <div style={{ ...panelShell, marginTop: 0 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 16, color: text }}>
        Access restricted
      </p>
      <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
        This section is only available to company admins and learning leads.
      </p>
    </div>
  );
}

export default function MyDashboard({ userEmail }: Props) {
  const [workspace, setWorkspace] = useState<WorkspaceBootstrapState>({
    memberships: [],
    loading: true,
    loadError: null,
    activeOrgId: null,
  });
  const [activeSection, setActiveSection] = useState<AppSection>("my_dashboard");

  useWorkspaceBootstrap(setWorkspace, workspace.activeOrgId);

  async function handleSignOut(e: FormEvent) {
    e.preventDefault();
    await supabase.auth.signOut();
  }

  const activeMembership =
    workspace.activeOrgId === null
      ? undefined
      : workspace.memberships.find(
          (m) => m.organisation_id === workspace.activeOrgId
        );

  const canAccessManagementNav = useMemo(
    () => canAccessWorkspaceManagementNav(activeMembership?.workspace_role),
    [activeMembership?.workspace_role]
  );

  useEffect(() => {
    if (workspace.loading) return;
    if (canAccessManagementNav) return;
    setActiveSection((prev) =>
      ELEVATED_SECTION_IDS.includes(prev) ? "my_dashboard" : prev
    );
  }, [workspace.loading, canAccessManagementNav, workspace.activeOrgId]);

  const showRestrictedManagementView =
    !canAccessManagementNav && ELEVATED_SECTION_IDS.includes(activeSection);

  const pageTitle = showRestrictedManagementView
    ? "Access restricted"
    : SECTION_LABELS[activeSection];

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div>
          <p className={styles.brand}>Capability Hub</p>
          <p className={styles.brandTagline}>Capability intelligence</p>
        </div>
        <nav className={styles.nav}>
          <div className={styles.navGroup}>
            <p className={styles.navGroupHeading}>PERSONAL</p>
            {PERSONAL_NAV.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`${styles.navButton} ${
                  activeSection === id ? styles.navButtonActive : ""
                }`}
                onClick={() => setActiveSection(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {canAccessManagementNav ? (
            <>
              <div className={styles.navGroup}>
                <p className={styles.navGroupHeading}>MANAGEMENT</p>
                {MANAGEMENT_NAV.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.navButton} ${
                      activeSection === id ? styles.navButtonActive : ""
                    }`}
                    onClick={() => setActiveSection(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.navGroup}>
                <p className={styles.navGroupHeading}>WORKSPACE ADMIN</p>
                {WORKSPACE_ADMIN_NAV.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.navButton} ${
                      activeSection === id ? styles.navButtonActive : ""
                    }`}
                    onClick={() => setActiveSection(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </nav>
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.topHeader}>
          <h1 className={styles.headerTitle}>{pageTitle}</h1>
          <div className={styles.headerMeta}>
            <span>
              Signed in as <strong>{userEmail}</strong>
            </span>
            <span>
              Workspace:{" "}
              <strong>
                {activeMembership
                  ? organisationLabel(activeMembership)
                  : "—"}
              </strong>
            </span>
            <form onSubmit={handleSignOut} style={{ display: "inline" }}>
              <button type="submit" className={styles.signOutBtn}>
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className={styles.mainScroll}>
          <div className={styles.mainScrollInner}>
          {workspace.loadError && (
            <p style={{ color: errorColor, marginTop: 0, fontSize: 14 }}>
              {workspace.loadError}
            </p>
          )}

          {workspace.loading ? (
            <p style={{ ...muted, marginTop: 12 }}>Loading…</p>
          ) : (
            <>
              <div hidden={activeSection !== "my_dashboard"}>
                <PersonalDashboardSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_dashboard"}
                  userEmail={userEmail}
                  onNavigateToMyDevelopment={() =>
                    setActiveSection("my_development")
                  }
                />
              </div>
              <div hidden={activeSection !== "my_profile"}>
                <MyProfileSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_profile"}
                  userEmail={userEmail}
                  activeMembership={activeMembership}
                />
              </div>
              <div hidden={activeSection !== "my_competencies"}>
                <MyCompetenciesSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_competencies"}
                />
              </div>
              <div hidden={activeSection !== "my_experience"}>
                <MyExperienceSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_experience"}
                />
              </div>
              <div hidden={activeSection !== "my_career"}>
                <MyCareerSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_career"}
                />
              </div>
              <div hidden={activeSection !== "my_development"}>
                <MyDevelopmentSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_development"}
                />
              </div>
              <div hidden={activeSection !== "my_team"}>
                <MyTeamSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_team"}
                />
              </div>
              <div hidden={activeSection !== "team_insights"}>
                <TeamInsightsSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "team_insights"}
                />
              </div>
              <div hidden={activeSection !== "job_profiles"}>
                {!canAccessManagementNav && activeSection === "job_profiles" ? (
                  <ManagementAccessRestricted />
                ) : canAccessManagementNav ? (
                  <JobProfilesSection
                    activeOrgId={workspace.activeOrgId}
                    isActive={activeSection === "job_profiles"}
                  />
                ) : null}
              </div>
              <div hidden={activeSection !== "member_capability"}>
                {!canAccessManagementNav &&
                activeSection === "member_capability" ? (
                  <ManagementAccessRestricted />
                ) : canAccessManagementNav ? (
                  <UsersSection
                    activeOrgId={workspace.activeOrgId}
                    isActive={activeSection === "member_capability"}
                    workspaceRole={activeMembership?.workspace_role ?? null}
                  />
                ) : null}
              </div>
              <div hidden={activeSection !== "user_admin"}>
                {!canAccessManagementNav &&
                activeSection === "user_admin" ? (
                  <ManagementAccessRestricted />
                ) : canAccessManagementNav ? (
                  <UserAdminSection
                    activeOrgId={workspace.activeOrgId}
                    isActive={activeSection === "user_admin"}
                    workspaceRole={activeMembership?.workspace_role ?? null}
                  />
                ) : null}
              </div>
              <div hidden={activeSection !== "teams"}>
                {!canAccessManagementNav && activeSection === "teams" ? (
                  <ManagementAccessRestricted />
                ) : canAccessManagementNav ? (
                  <TeamsSection
                    activeOrgId={workspace.activeOrgId}
                    isActive={activeSection === "teams"}
                    workspaceRole={activeMembership?.workspace_role ?? null}
                  />
                ) : null}
              </div>
              <div hidden={activeSection !== "company_profile"}>
                {!canAccessManagementNav &&
                activeSection === "company_profile" ? (
                  <ManagementAccessRestricted />
                ) : canAccessManagementNav ? (
                  <CompanyProfileSection
                    activeOrgId={workspace.activeOrgId}
                    isActive={activeSection === "company_profile"}
                    workspaceRole={activeMembership?.workspace_role ?? null}
                  />
                ) : null}
              </div>
              <div hidden={activeSection !== "competency_management"}>
                {!canAccessManagementNav &&
                activeSection === "competency_management" ? (
                  <ManagementAccessRestricted />
                ) : canAccessManagementNav ? (
                  <CompetenciesSection
                    activeOrgId={workspace.activeOrgId}
                    isActive={activeSection === "competency_management"}
                    workspaceRole={activeMembership?.workspace_role ?? null}
                  />
                ) : null}
              </div>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

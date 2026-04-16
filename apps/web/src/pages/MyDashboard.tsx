import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import styles from "./MyDashboard.module.css";
import { useWorkspaceBootstrap } from "./DashboardSection";
import { PersonalDashboardSection } from "./PersonalDashboardSection";
import { ProfilePanel } from "./ProfilePanel";
import { JobProfilesSection } from "./JobProfilesSection";
import { CompetenciesSection } from "./CompetenciesSection";
import { StarterPacksSection } from "./StarterPacksSection";
import { SystemReferenceLibrarySection } from "./SystemReferenceLibrarySection";
import { AppShellFooter } from "./AppShellFooter";
import { HelpCenterAdminSection } from "./helpCenter/HelpCenterAdminSection";
import { HelpAssistantPanel } from "./help/HelpAssistantPanel";
import { MyCompetenciesSection } from "./MyCompetenciesSection";
import { MyExperienceSection } from "./MyExperienceSection";
import { MyCareerSection } from "./MyCareerSection";
import { MyDevelopmentSection } from "./MyDevelopmentSection";
import { ApplicationEvaluationsSection } from "./ApplicationEvaluationsSection";
import { MyTeamSection } from "./MyTeamSection";
import { TeamInsightsSection } from "./TeamInsightsSection";
import { UsersSection } from "./UsersSection";
import { UserAdminSection } from "./UserAdminSection";
import { TeamsSection } from "./TeamsSection";
import { CompanyProfileSection } from "./CompanyProfileSection";
import { IndustryInsightsSection } from "./IndustryInsightsSection";
import type {
  AppSection,
  ProfileRow,
  WorkspaceBootstrapState,
} from "./hub/types";
import {
  formatWorkspaceRole,
  fullNameFromProfile,
  organisationLabel,
  profileFirstName,
  profileInitials,
} from "./hub/hubUtils";
import {
  buildRoleDisplayParts,
  hasPlatformReferenceLibraryOperatorCapability,
} from "../lib/roleModel";
import { pickEffectiveMembershipForOrganisation } from "./hub/effectiveMembership";
import { canAccessWorkspaceManagementNav } from "./hub/workspaceRoles";
import {
  activeBanner,
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

/** Core personal areas — always shown for every signed-in user. */
const PERSONAL_NAV_CORE: { id: AppSection; label: string }[] = [
  { id: "my_dashboard", label: "My Dashboard" },
  { id: "my_competencies", label: "My Competencies" },
  { id: "my_experience", label: "My Experience" },
  { id: "my_career", label: "My Career" },
  { id: "my_development", label: "My Development" },
  { id: "application_evaluations", label: "Application Evaluations" },
];

/** Team / org-wide insight items — hidden for `primary_account_type = personal` standalone users. */
const PERSONAL_NAV_WORKSPACE_SOCIAL: { id: AppSection; label: string }[] = [
  { id: "my_team", label: "My Team" },
  { id: "team_insights", label: "Team Insights" },
  { id: "industry_insights", label: "Industry Insights" },
];

/** Full personal rail for organisation-primary or legacy users who may use workspace features. */
const PERSONAL_NAV: { id: AppSection; label: string }[] = [
  ...PERSONAL_NAV_CORE,
  ...PERSONAL_NAV_WORKSPACE_SOCIAL,
];

/** Future: append e.g. `{ id: "my_applications", label: "My Applications" }` to PERSONAL_NAV_CORE when implemented. */

const MANAGEMENT_NAV: { id: AppSection; label: string }[] = [
  { id: "job_profiles", label: "Job Profiles" },
  { id: "competency_management", label: "Competency Management" },
  { id: "starter_packs", label: "Starter packs" },
  { id: "member_capability", label: "Member Capability" },
];

const WORKSPACE_ADMIN_NAV: { id: AppSection; label: string }[] = [
  { id: "user_admin", label: "User Admin" },
  { id: "teams", label: "Teams" },
  { id: "company_profile", label: "Company Profile" },
];

const SYSTEM_PLATFORM_NAV: { id: AppSection; label: string }[] = [
  { id: "system_reference_library", label: "Reference library" },
  { id: "system_help_center", label: "Help Center" },
];

/** Sections that require company admin or learning lead */
const ELEVATED_SECTION_IDS: AppSection[] = [
  "job_profiles",
  "competency_management",
  "member_capability",
  "user_admin",
  "teams",
   "company_profile",
  "starter_packs",
  "system_reference_library",
  "system_help_center",
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
    allMembershipRows: [],
    loading: true,
    loadError: null,
    activeOrgId: null,
  });
  const [activeSection, setActiveSection] = useState<AppSection>("my_dashboard");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [headerProfileRefresh, setHeaderProfileRefresh] = useState(0);
  const [experienceReloadToken, setExperienceReloadToken] = useState(0);
  const [consultantOnboardingNote, setConsultantOnboardingNote] = useState<
    string | null
  >(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const [headerProfile, setHeaderProfile] = useState<{
    loading: boolean;
    firstName: string;
    displayName: string;
    avatarUrl: string | null;
    initials: string;
    jobTitle: string | null;
    jobLevel: string | null;
    workspaceRoleLabel: string;
    platformBadges: string[];
    profileSystemRole: string | null;
    /** From profiles.primary_account_type — drives personal-only shell. */
    primaryAccountType: string | null;
  }>({
    loading: true,
    firstName: "Member",
    displayName: "",
    avatarUrl: null,
    initials: "?",
    jobTitle: null,
    jobLevel: null,
    workspaceRoleLabel: "—",
    platformBadges: [],
    profileSystemRole: null,
    primaryAccountType: null,
  });

  useWorkspaceBootstrap(setWorkspace, workspace.activeOrgId);

  useEffect(() => {
    if (workspace.loading) return;
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        if (!cancelled) setConsultantOnboardingNote(null);
        return;
      }
      const cr = await supabase
        .from("consultant_requests")
        .select("status")
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (cr.data?.status === "pending") {
        setConsultantOnboardingNote(
          "Your learning consultant application is awaiting Capability Studio operator approval. You will not have organisation data access until your role is approved and an organisation owner links you to their workspace.",
        );
        return;
      }
      if (cr.data?.status === "rejected") {
        setConsultantOnboardingNote(
          "Your learning consultant application was not approved. Contact Capability Studio support if you need help.",
        );
        return;
      }
      const pend = await supabase
        .from("workspace_memberships")
        .select("id, organisations(name)")
        .eq("user_id", uid)
        .eq("access_type", "consultant")
        .eq("approved_by_owner", false)
        .eq("membership_status", "active");
      if (cancelled) return;
      const rows = pend.data as
        | { organisations?: { name?: string | null } | null }[]
        | null;
      if (rows && rows.length > 0) {
        const names = rows
          .map((r) => r.organisations?.name)
          .filter(Boolean)
          .join(", ");
        setConsultantOnboardingNote(
          names
            ? `Consultant access is pending organisation owner approval for: ${names}.`
            : "Consultant access is pending organisation owner approval.",
        );
        return;
      }
      setConsultantOnboardingNote(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.loading, workspace.memberships.length]);

  async function handleSignOut(e: FormEvent) {
    e.preventDefault();
    await supabase.auth.signOut();
  }

  const activeMembership = useMemo(
    () =>
      pickEffectiveMembershipForOrganisation(
        workspace.memberships,
        workspace.activeOrgId,
      ),
    [workspace.memberships, workspace.activeOrgId],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadHeaderProfile() {
      if (workspace.loading) return;

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        if (!cancelled) {
          setHeaderProfile((prev) => ({ ...prev, loading: false }));
        }
        return;
      }

      if (!cancelled) {
        setHeaderProfile((prev) => ({ ...prev, loading: true }));
      }

      const profRes = await supabase
        .from("profiles")
        .select(
          "first_name, last_name, display_name, avatar_url, email, system_role, primary_account_type",
        )
        .eq("id", uid)
        .maybeSingle();

      if (cancelled) return;

      const row = profRes.data as ProfileRow | null;
      const displayName = fullNameFromProfile(
        row
          ? {
              display_name: row.display_name,
              first_name: row.first_name,
              last_name: row.last_name,
              email: row.email ?? userEmail,
            }
          : { email: userEmail }
      );
      const firstName = profileFirstName(
        row
          ? {
              first_name: row.first_name,
              display_name: row.display_name,
              email: row.email ?? userEmail,
            }
          : { email: userEmail }
      );
      const initials = profileInitials(
        row
          ? {
              first_name: row.first_name,
              last_name: row.last_name,
              display_name: row.display_name,
              email: row.email ?? userEmail,
            }
          : { email: userEmail }
      );

      let jobTitle: string | null = null;
      let jobLevel: string | null = null;
      if (workspace.activeOrgId) {
        const ujpRes = await supabase
          .from("user_job_profiles")
          .select("job_profile_id")
          .eq("organisation_id", workspace.activeOrgId)
          .eq("user_id", uid)
          .maybeSingle();

        if (!ujpRes.error && ujpRes.data) {
          const jid = (ujpRes.data as { job_profile_id: string | null })
            .job_profile_id;
          if (jid) {
            const jpRes = await supabase
              .from("job_profiles")
              .select("title, level_name")
              .eq("id", jid)
              .maybeSingle();
            if (!jpRes.error && jpRes.data) {
              const jp = jpRes.data as {
                title: string;
                level_name: string | null;
              };
              jobTitle = jp.title;
              jobLevel = jp.level_name;
            }
          }
        } else if (ujpRes.error) {
          console.warn("user_job_profiles:", ujpRes.error.message);
        }
      }

      const roleParts = buildRoleDisplayParts(
        activeMembership,
        workspace.activeOrgId,
        row,
        formatWorkspaceRole,
        {
          hasReferenceLibraryOperatorCapability:
            hasPlatformReferenceLibraryOperatorCapability(
              workspace.allMembershipRows,
              userEmail,
            ),
        },
      );

      const pat = (row?.primary_account_type as string | null | undefined) ?? null;
      let workspaceRoleLabel = roleParts.workspaceRoleLabel;
      if (pat === "personal" && !activeMembership) {
        workspaceRoleLabel = "Personal account";
      }

      if (!cancelled) {
        setHeaderProfile({
          loading: false,
          firstName,
          displayName,
          avatarUrl: row?.avatar_url ?? null,
          initials,
          jobTitle,
          jobLevel,
          workspaceRoleLabel,
          platformBadges: roleParts.platformBadges,
          profileSystemRole: (row?.system_role as string | null) ?? null,
          primaryAccountType: pat,
        });
      }
    }
    void loadHeaderProfile();
    return () => {
      cancelled = true;
    };
  }, [
    workspace.loading,
    workspace.activeOrgId,
    workspace.allMembershipRows,
    userEmail,
    headerProfileRefresh,
    activeMembership?.id,
    activeMembership?.workspace_role,
    activeMembership?.system_role,
    activeMembership?.access_type,
    activeMembership?.approved_by_owner,
  ]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    function handleDocMouseDown(e: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(e.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [profileMenuOpen]);

  const canAccessManagementNav = useMemo(
    () => canAccessWorkspaceManagementNav(activeMembership?.workspace_role),
    [activeMembership?.workspace_role]
  );

  const canAccessSystemReferenceLibrary = useMemo(
    () =>
      hasPlatformReferenceLibraryOperatorCapability(
        workspace.allMembershipRows,
        userEmail,
      ),
    [workspace.allMembershipRows, userEmail],
  );

  /** Help audience: treat as platform operator if any membership qualifies, else current row. */
  const helpMembershipSystemRole = useMemo(() => {
    if (canAccessSystemReferenceLibrary) return "system_admin";
    return activeMembership?.system_role ?? null;
  }, [canAccessSystemReferenceLibrary, activeMembership?.system_role]);

  useEffect(() => {
    if (workspace.loading) return;
    if (canAccessManagementNav) return;
    setActiveSection((prev) => {
      if (
        (prev === "system_reference_library" || prev === "system_help_center") &&
        canAccessSystemReferenceLibrary
      ) {
        return prev;
      }
      return ELEVATED_SECTION_IDS.includes(prev) ? "my_dashboard" : prev;
    });
  }, [
    workspace.loading,
    canAccessManagementNav,
    canAccessSystemReferenceLibrary,
    workspace.activeOrgId,
  ]);

  useEffect(() => {
    if (workspace.loading) return;
    if (
      activeSection !== "system_reference_library" &&
      activeSection !== "system_help_center"
    ) {
      return;
    }
    if (canAccessSystemReferenceLibrary) return;
    setActiveSection("my_dashboard");
  }, [
    workspace.loading,
    activeSection,
    canAccessSystemReferenceLibrary,
  ]);

  const isSystemAdminSection =
    activeSection === "system_reference_library" ||
    activeSection === "system_help_center";

  const showRestrictedManagementView =
    (isSystemAdminSection && !canAccessSystemReferenceLibrary) ||
    (!isSystemAdminSection &&
      !canAccessManagementNav &&
      ELEVATED_SECTION_IDS.includes(activeSection));

  const headerJobLine =
    headerProfile.jobTitle != null
      ? headerProfile.jobLevel
        ? `${headerProfile.jobTitle} · ${headerProfile.jobLevel}`
        : headerProfile.jobTitle
      : "No job profile assigned";

  const isPersonalPrimaryAccount =
    headerProfile.primaryAccountType === "personal";

  const personalNavEntries = useMemo(
    () =>
      isPersonalPrimaryAccount ? PERSONAL_NAV_CORE : PERSONAL_NAV,
    [isPersonalPrimaryAccount],
  );

  const headerContextIsPersonalStandalone =
    isPersonalPrimaryAccount && !activeMembership;

  const pageTitle = showRestrictedManagementView
    ? "Access restricted"
    : SECTION_LABELS[activeSection];

  const showIndependentNoWorkspaceBanner =
    !workspace.loading &&
    !headerProfile.loading &&
    !consultantOnboardingNote &&
    !workspace.loadError &&
    workspace.memberships.length === 0 &&
    headerProfile.primaryAccountType !== "personal";

  useEffect(() => {
    if (workspace.loading || headerProfile.loading) return;
    if (headerProfile.primaryAccountType !== "personal") return;
    const hiddenForPersonal: AppSection[] = [
      "my_team",
      "team_insights",
      "industry_insights",
    ];
    if (hiddenForPersonal.includes(activeSection)) {
      setActiveSection("my_dashboard");
    }
  }, [
    workspace.loading,
    headerProfile.loading,
    headerProfile.primaryAccountType,
    activeSection,
  ]);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div>
          <p className={styles.brandEyebrow}>Feijoa8</p>
          <p className={styles.brand}>
            <span className={styles.brandProduct}>Capability Studio</span>
          </p>
          <p className={styles.brandTagline}>Capability intelligence · Enlighten</p>
        </div>
        <nav className={styles.nav}>
          <div className={styles.navGroup}>
            <p className={styles.navGroupHeading}>PERSONAL</p>
            {personalNavEntries.map(({ id, label }) => (
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
          {canAccessSystemReferenceLibrary ? (
            <div className={styles.navGroup}>
              <p className={styles.navGroupHeading}>SYSTEM</p>
              {SYSTEM_PLATFORM_NAV.map(({ id, label }) => (
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
          ) : null}
        </nav>
      </aside>
      <div className={styles.mainColumn}>
        <header className={styles.topHeader}>
          <h1 className={styles.headerTitle}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span>{pageTitle}</span>
              {canAccessSystemReferenceLibrary ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "#8eb8e8",
                    border: "1px solid #3d4f68",
                    borderRadius: 6,
                    padding: "2px 8px",
                  }}
                >
                  Platform operator
                </span>
              ) : null}
            </span>
          </h1>
          <div className={styles.headerMeta}>
            <span>
              {headerContextIsPersonalStandalone ? (
                <>
                  Context: <strong>Personal Account</strong>
                </>
              ) : (
                <>
                  Workspace:{" "}
                  <strong>
                    {activeMembership
                      ? organisationLabel(activeMembership)
                      : "—"}
                  </strong>
                </>
              )}
            </span>
            <div className={styles.headerMetaRight}>
              <div ref={profileMenuRef} className={styles.profileMenuWrap}>
                <button
                  type="button"
                  className={styles.profileTrigger}
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="true"
                  onClick={() => setProfileMenuOpen((open) => !open)}
                >
                  {headerProfile.avatarUrl ? (
                    <img
                      className={styles.profileAvatarSm}
                      src={headerProfile.avatarUrl}
                      alt=""
                      width={32}
                      height={32}
                    />
                  ) : (
                    <span className={styles.profileAvatarSmFallback}>
                      {headerProfile.loading ? "…" : headerProfile.initials}
                    </span>
                  )}
                  <span>
                    {headerProfile.loading ? "…" : headerProfile.firstName}
                  </span>
                  <span className={styles.profileTriggerChevron} aria-hidden>
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path
                        fill="currentColor"
                        d="M2.8 4.2h6.4L6 8.4 2.8 4.2z"
                      />
                    </svg>
                  </span>
                </button>
                {profileMenuOpen ? (
                  <div className={styles.profileDropdown} role="menu">
                    <div className={styles.profileDropdownMeta}>
                      <p className={styles.profileDropdownName}>
                        {headerProfile.displayName || userEmail}
                      </p>
                      <p className={styles.profileDropdownSub}>
                        {headerProfile.workspaceRoleLabel}
                        {headerProfile.platformBadges.length > 0 ? (
                          <>
                            {" "}
                            <span style={{ color: mutedColor }}>
                              ·{" "}
                              {headerProfile.platformBadges.join(" · ")}
                            </span>
                          </>
                        ) : null}
                        <br />
                        {headerJobLine}
                      </p>
                    </div>
                    <hr className={styles.profileDropdownDivider} />
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.profileDropdownItem}
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setProfilePanelOpen(true);
                      }}
                    >
                      My Profile
                    </button>
                    <form onSubmit={handleSignOut} style={{ margin: 0 }}>
                      <button
                        type="submit"
                        role="menuitem"
                        className={`${styles.profileDropdownItem} ${styles.profileDropdownItemDanger}`}
                      >
                        Sign out
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        <div className={styles.mainScroll}>
          <div className={styles.mainScrollInner}>
          {consultantOnboardingNote ? (
            <div
              style={{
                ...activeBanner,
                marginBottom: 20,
                fontSize: 14,
                color: text,
                lineHeight: 1.5,
              }}
              role="status"
            >
              {consultantOnboardingNote}
            </div>
          ) : null}
          {showIndependentNoWorkspaceBanner ? (
            <div
              style={{
                ...activeBanner,
                marginBottom: 20,
                fontSize: 14,
                color: text,
                lineHeight: 1.5,
              }}
              role="status"
            >
              You&apos;re signed in without a linked workspace. Personal areas (dashboard,
              competencies, experience, career, development, profile) are available. Team and
              organisation features appear when you create a workspace or accept an invitation.
            </div>
          ) : null}
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
                  workspaceRole={activeMembership?.workspace_role ?? null}
                  onNavigateToMyDevelopment={() =>
                    setActiveSection("my_development")
                  }
                />
              </div>
              <div hidden={activeSection !== "my_competencies"}>
                <MyCompetenciesSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_competencies"}
                  primaryAccountType={headerProfile.primaryAccountType}
                  primaryAccountTypeReady={!headerProfile.loading}
                />
              </div>
              <div hidden={activeSection !== "my_experience"}>
                <MyExperienceSection
                  activeOrgId={workspace.activeOrgId}
                  activeWorkspaceMembership={activeMembership}
                  isActive={activeSection === "my_experience"}
                  reloadToken={experienceReloadToken}
                  primaryAccountType={headerProfile.primaryAccountType}
                  primaryAccountTypeReady={!headerProfile.loading}
                />
              </div>
              <div hidden={activeSection !== "my_career"}>
                <MyCareerSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_career"}
                  primaryAccountType={headerProfile.primaryAccountType}
                  primaryAccountTypeReady={!headerProfile.loading}
                />
              </div>
              <div hidden={activeSection !== "my_development"}>
                <MyDevelopmentSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "my_development"}
                  primaryAccountType={headerProfile.primaryAccountType}
                  primaryAccountTypeReady={!headerProfile.loading}
                />
              </div>
              <div hidden={activeSection !== "application_evaluations"}>
                <ApplicationEvaluationsSection
                  isActive={activeSection === "application_evaluations"}
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
              <div hidden={activeSection !== "industry_insights"}>
                <IndustryInsightsSection
                  activeOrgId={workspace.activeOrgId}
                  isActive={activeSection === "industry_insights"}
                  workspaceRole={activeMembership?.workspace_role ?? null}
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
              <div hidden={activeSection !== "starter_packs"}>
                {!canAccessManagementNav && activeSection === "starter_packs" ? (
                  <ManagementAccessRestricted />
                ) : canAccessManagementNav ? (
                  <StarterPacksSection
                    activeOrgId={workspace.activeOrgId}
                    isActive={activeSection === "starter_packs"}
                    workspaceRole={activeMembership?.workspace_role ?? null}
                  />
                ) : null}
              </div>
              <div hidden={activeSection !== "system_reference_library"}>
                {showRestrictedManagementView &&
                activeSection === "system_reference_library" ? (
                  <ManagementAccessRestricted />
                ) : canAccessSystemReferenceLibrary ? (
                  <SystemReferenceLibrarySection
                    isActive={activeSection === "system_reference_library"}
                  />
                ) : null}
              </div>
              <div hidden={activeSection !== "system_help_center"}>
                {showRestrictedManagementView &&
                activeSection === "system_help_center" ? (
                  <ManagementAccessRestricted />
                ) : canAccessSystemReferenceLibrary ? (
                  <HelpCenterAdminSection
                    isActive={activeSection === "system_help_center"}
                  />
                ) : null}
              </div>
            </>
          )}
          </div>
        </div>
        <AppShellFooter onOpenAssistant={() => setAssistantOpen(true)} />
      </div>
      <ProfilePanel
        open={profilePanelOpen}
        onClose={() => setProfilePanelOpen(false)}
        userEmail={userEmail}
        activeOrgId={workspace.activeOrgId}
        activeMembership={activeMembership}
        onProfileUpdated={() => {
          setHeaderProfileRefresh((k) => k + 1);
          setExperienceReloadToken((k) => k + 1);
        }}
      />
      <HelpAssistantPanel
        open={assistantOpen}
        onOpen={() => setAssistantOpen(true)}
        onClose={() => setAssistantOpen(false)}
        activeSection={activeSection}
        workspaceRole={activeMembership?.workspace_role ?? null}
        membershipSystemRole={helpMembershipSystemRole}
        profileSystemRole={headerProfile.profileSystemRole}
        organisationId={workspace.activeOrgId}
        userEmail={userEmail}
      />
    </div>
  );
}

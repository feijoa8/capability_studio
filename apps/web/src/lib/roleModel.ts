/**
 * Phase 1 — Capability Studio role & access model (single source of truth for UI).
 *
 * Concepts (must stay separate):
 * - **profiles.system_role** — platform only: `learning_consultant` | null. Never infer from email.
 * - **workspace_memberships.system_role** — platform operator flag on a row: `system_admin` only (Feijoa8 ref-library pairing in DB). Not a workspace/org “job” role.
 * - **workspace_memberships.workspace_role** — org role: company_owner, company_admin, company_it_admin, learning_lead, member.
 * - **workspace_memberships.access_type** — `standard` | `consultant` (external consultant link).
 *
 * Billing (future): org billing owner → typically **company_owner**; personal billing → **member** in independent context. Do not treat company_admin or consultant as default billing owner.
 *
 * @feijoa8.com — eligibility for pairing with **WM.system_admin** only (see DB); never grants privilege or UI by itself.
 */

import type { WorkspaceMembership } from "../pages/hub/types";
import { membershipGrantsOrgData } from "./membershipEffective";

const FEIJOA8_EMAIL_RE = /^[^@]+@feijoa8\.com$/i;

export function normalizeRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase() ?? "";
}

/** Domain check only — never use alone for nav, access, or displayed authority. */
export function emailEligibleForFeijoa8PlatformOperator(
  email: string | null | undefined,
): boolean {
  return FEIJOA8_EMAIL_RE.test((email ?? "").trim());
}

/** `profiles.system_role` — only `learning_consultant` is used today. */
export function profilePlatformSystemRole(
  profile: { system_role?: string | null } | null | undefined,
): "learning_consultant" | null {
  return normalizeRole(profile?.system_role) === "learning_consultant"
    ? "learning_consultant"
    : null;
}

/** `workspace_memberships.system_role` on a row — only `system_admin` is valid for platform operators. */
export function membershipRowPlatformRole(
  m: WorkspaceMembership | null | undefined,
): "system_admin" | null {
  return normalizeRole(m?.system_role) === "system_admin" ? "system_admin" : null;
}

/** Workspace “job” role for the active org (explicit assignment only). */
export function effectiveWorkspaceRoleForActiveMembership(
  m: WorkspaceMembership | null | undefined,
): string | null {
  const r = m?.workspace_role?.trim();
  return r || null;
}

/**
 * Mirrors DB `is_reference_library_admin()`: any **active** membership with
 * `system_role = system_admin` **and** Feijoa8 sign-in email.
 * Does not depend on which org is selected — system_admin must not imply access to every org.
 */
export function hasPlatformReferenceLibraryOperatorCapability(
  memberships: WorkspaceMembership[],
  userEmail: string | null | undefined,
): boolean {
  if (!emailEligibleForFeijoa8PlatformOperator(userEmail)) return false;
  return memberships.some(
    (m) =>
      m.membership_status === "active" &&
      membershipRowPlatformRole(m) === "system_admin",
  );
}

/** Same as {@link membershipGrantsOrgData} — org data / shell availability. */
export function membershipGrantsWorkspaceAccess(
  m: WorkspaceMembership,
  profileSystemRole: string | null | undefined,
): boolean {
  return membershipGrantsOrgData(m, profileSystemRole);
}

/** Consultant link exists but owner has not approved — row may be in DB but must not behave as full access. */
export function consultantAwaitingOwnerApproval(
  m: WorkspaceMembership | null | undefined,
): boolean {
  if (!m || m.membership_status !== "active") return false;
  if (normalizeRole(m.access_type) !== "consultant") return false;
  return m.approved_by_owner !== true;
}

/** Approved learning consultant for this org (all gates satisfied). */
export function isApprovedLearningConsultantForOrg(
  m: WorkspaceMembership | null | undefined,
  profileSystemRole: string | null | undefined,
): boolean {
  if (!m || m.membership_status !== "active") return false;
  if (normalizeRole(m.access_type) !== "consultant") return false;
  return (
    m.approved_by_owner === true &&
    normalizeRole(profileSystemRole) === "learning_consultant"
  );
}

export type RoleDisplayParts = {
  /** Primary: assigned workspace role for the active org (never blended with platform roles). */
  workspaceRoleLabel: string;
  /** Secondary chips for platform context (system operator, learning consultant, consultant access mode). */
  platformBadges: string[];
};

/**
 * Build header / profile display lines. Primary label is always the assigned workspace role;
 * platform roles appear only as separate badges.
 */
export function buildRoleDisplayParts(
  activeMembership: WorkspaceMembership | null | undefined,
  activeOrgId: string | null | undefined,
  profile: { system_role?: string | null } | null | undefined,
  formatWorkspaceRole: (r: string | null | undefined) => string,
  opts: {
    hasReferenceLibraryOperatorCapability: boolean;
  },
): RoleDisplayParts {
  let workspaceRoleLabel: string;
  if (activeOrgId == null || activeOrgId === "") {
    workspaceRoleLabel = "Member (independent)";
  } else if (!activeMembership) {
    workspaceRoleLabel = "—";
  } else {
    const wr = effectiveWorkspaceRoleForActiveMembership(activeMembership);
    workspaceRoleLabel = formatWorkspaceRole(wr);
  }

  const platformBadges: string[] = [];

  if (opts.hasReferenceLibraryOperatorCapability) {
    platformBadges.push("Platform operator");
  }

  if (profilePlatformSystemRole(profile) === "learning_consultant") {
    platformBadges.push("Learning consultant");
  }

  if (
    activeMembership &&
    normalizeRole(activeMembership.access_type) === "consultant" &&
    consultantAwaitingOwnerApproval(activeMembership)
  ) {
    platformBadges.push("Consultant access (pending owner)");
  }

  return { workspaceRoleLabel, platformBadges };
}

/*
 * Phase 1 QA — before changing auth / 2FA, verify:
 * - Shell org list uses memberships filtered by membershipGrantsOrgData (consultant gates).
 * - Reference library nav uses hasPlatformReferenceLibraryOperatorCapability(allMembershipRows, email),
 *   not the active org row alone, and never email-only.
 * - Header primary label = workspace_role for active org; platform badges = operator / learning_consultant / pending consultant.
 * - Billing: org owner → company_owner; independent → member — do not assume company_admin or consultant bill by default.
 */

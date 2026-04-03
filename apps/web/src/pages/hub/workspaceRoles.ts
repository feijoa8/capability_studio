/**
 * Workspace role helpers for UI gating (frontend only; RLS remains authoritative).
 *
 * Canonical elevated admin roles — prefer these in new code:
 * - company_owner
 * - company_admin
 * - company_it_admin
 *
 * Legacy roles still recognised where existing data / UX required:
 * - learning_lead (elevated; management nav + admin surfaces)
 * - admin (alias on some surfaces only; see helpers below)
 */

export const WORKSPACE_ADMIN_ROLES = [
  "company_owner",
  "company_admin",
  "company_it_admin",
] as const;

export type WorkspaceAdminRole = (typeof WORKSPACE_ADMIN_ROLES)[number];

function normalizedRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase() ?? "";
}

/** True when the role is one of the canonical workspace admin roles (case-insensitive). */
export function isWorkspaceAdminRole(role: string | null | undefined): boolean {
  const r = normalizedRole(role);
  if (!r) return false;
  return (WORKSPACE_ADMIN_ROLES as readonly string[]).includes(r);
}

/**
 * Job Profiles, Competency Management, Member Capability, User Admin, Teams nav.
 * Matches previous `canAccessManagement` in MyDashboard: primary admins + learning_lead.
 * Does not include legacy `admin` alias (those users did not get management nav before).
 */
export function canAccessWorkspaceManagementNav(
  role: string | null | undefined
): boolean {
  const r = normalizedRole(role);
  if (!r) return false;
  if (isWorkspaceAdminRole(role)) return true;
  return r === "learning_lead";
}

/**
 * User Admin, Teams, Users (view all members), etc.: primary admins + learning_lead + legacy `admin`.
 */
export function canAccessWorkspaceAdminSurfaces(
  role: string | null | undefined
): boolean {
  const r = normalizedRole(role);
  if (!r) return false;
  if (isWorkspaceAdminRole(role)) return true;
  return r === "learning_lead" || r === "admin";
}

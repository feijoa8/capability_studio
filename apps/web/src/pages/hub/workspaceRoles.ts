/**
 * Workspace role helpers for UI gating (frontend only; RLS remains authoritative).
 *
 * See `lib/roleModel.ts` for platform vs workspace separation and consultant rules.
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

import type { WorkspaceMembership } from "./types";
import {
  emailEligibleForFeijoa8PlatformOperator,
  hasPlatformReferenceLibraryOperatorCapability,
} from "../../lib/roleModel";

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

/** Eligibility only — never use alone for authority; pair with WM.system_admin (see roleModel). */
export function isFeijoa8SystemOperatorEmail(
  email: string | null | undefined,
): boolean {
  return emailEligibleForFeijoa8PlatformOperator(email);
}

/**
 * @deprecated Prefer `hasPlatformReferenceLibraryOperatorCapability(memberships, email)` — the
 * active org’s row alone is not sufficient when the operator flag sits on another membership.
 *
 * Shared reference library admin surfaces (system reference library, starter pack editor).
 * Must match DB `is_reference_library_admin()`: active membership with
 * `system_role = 'system_admin'` and an @feijoa8.com sign-in email.
 */
export function isReferenceLibrarySystemAdmin(
  membership: { system_role?: string | null } | null | undefined,
  userEmail: string | null | undefined,
): boolean {
  const m = membership as WorkspaceMembership | null | undefined;
  return hasPlatformReferenceLibraryOperatorCapability(m ? [m] : [], userEmail);
}

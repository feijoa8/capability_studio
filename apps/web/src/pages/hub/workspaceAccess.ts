/**
 * Canonical workspace access helpers (single source of truth for product rules).
 *
 * Legacy / alias mapping (stored values may still exist in DB):
 * - `company_owner` → treated as **Organisation lead** (accountable org lead) for access checks.
 * - `team_manager` → treated as **Manager** for Talent Management add-on and manager-style UX.
 * - UI `admin` option → persisted as `company_admin` (see Manage Members / RPC mapping).
 *
 * Do not scatter ad-hoc string checks in the shell — extend this module instead.
 */

import type { WorkspaceMembership } from "./types";
import {
  hasPlatformReferenceLibraryOperatorCapability,
  normalizeRole,
} from "../../lib/roleModel";

export function isSystemAdmin(
  memberships: WorkspaceMembership[],
  userEmail: string | null | undefined,
): boolean {
  return hasPlatformReferenceLibraryOperatorCapability(memberships, userEmail);
}

/** Organisation accountable lead — new name or legacy `company_owner`. */
export function isOrganisationLead(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === "organisation_lead" || r === "company_owner";
}

/** Delegated company / platform operator (UI `admin` → stored as company_admin). */
export function isCompanyAdmin(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === "company_admin" || r === "admin";
}

export function isRecruiter(role: string | null | undefined): boolean {
  return normalizeRole(role) === "recruiter";
}

/** Manager line roles (includes legacy team_manager). */
export function isManagerRole(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === "manager" || r === "team_manager";
}

export function isLearningLead(role: string | null | undefined): boolean {
  return normalizeRole(role) === "learning_lead";
}

/**
 * Talent Management (Hiring + Talent Search).
 *
 * Target rule (final baseline):
 *   isSystemAdmin
 *   OR workspace_role IN ('organisation_lead', 'company_admin', 'recruiter')
 *   OR (workspace_role IN ('manager', 'team_manager', 'learning_lead') AND has_talent_management_access)
 *
 * Legacy rows still in the database are mapped explicitly below (not in MyDashboard):
 *   - `company_owner` → same default TM as organisation_lead
 *   - `team_manager` → same add-on path as manager
 */
export function canAccessTalentManagement(
  m: WorkspaceMembership | null | undefined,
  opts: {
    userEmail: string | null | undefined;
    allMemberships: WorkspaceMembership[];
  },
): boolean {
  if (!m || normalizeRole(m.membership_status) !== "active") return false;
  if (isSystemAdmin(opts.allMemberships, opts.userEmail)) return true;

  const r = normalizeRole(m.workspace_role);

  const baselineTalentRoles =
    r === "organisation_lead" || r === "company_admin" || r === "recruiter";

  const legacyMappedToBaselineTalentRoles = r === "company_owner";

  if (baselineTalentRoles || legacyMappedToBaselineTalentRoles) return true;

  if (
    (isManagerRole(m.workspace_role) || isLearningLead(m.workspace_role)) &&
    m.has_talent_management_access === true
  ) {
    return true;
  }

  return false;
}

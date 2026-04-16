import type { WorkspaceMembership } from "../pages/hub/types";

/** True when this membership row should expose org-scoped data (matches RLS workspace_membership_row_effective). */
export function membershipGrantsOrgData(
  m: WorkspaceMembership,
  profileSystemRole: string | null | undefined,
): boolean {
  if (m.membership_status !== "active") return false;
  const at = m.access_type ?? "standard";
  if (at === "consultant") {
    return (
      m.approved_by_owner === true &&
      profileSystemRole === "learning_consultant"
    );
  }
  return true;
}

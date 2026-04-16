import type { WorkspaceMembership } from "./types";

function normStatus(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Picks the canonical membership row for a workspace/org context.
 * - Same organisation may have multiple rows; prefer `membership_status = active`,
 *   then `is_primary = true`, then stable `id` order.
 */
export function pickEffectiveMembershipForOrganisation(
  memberships: WorkspaceMembership[],
  organisationId: string | null | undefined,
): WorkspaceMembership | undefined {
  if (organisationId == null || organisationId === "") return undefined;

  const forOrg = memberships.filter((m) => m.organisation_id === organisationId);
  if (forOrg.length === 0) return undefined;
  if (forOrg.length === 1) return forOrg[0];

  const active = forOrg.filter((m) => normStatus(m.membership_status) === "active");
  const pool = active.length > 0 ? active : forOrg;

  const primary = pool.filter((m) => m.is_primary === true);
  if (primary.length === 1) return primary[0];
  if (primary.length > 1) {
    return [...primary].sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  return [...pool].sort((a, b) => a.id.localeCompare(b.id))[0];
}

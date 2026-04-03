import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Direct manager for the user in this organisation, if a reporting line exists.
 */
export async function fetchMyManagerId(
  client: SupabaseClient,
  organisationId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await client
    .from("user_reporting_lines")
    .select("manager_user_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("user_reporting_lines (manager):", error.message);
    return null;
  }
  const row = data as { manager_user_id: string } | null;
  return row?.manager_user_id ?? null;
}

/**
 * User IDs of people who report to this manager in the organisation.
 */
export async function fetchMyTeamMemberIds(
  client: SupabaseClient,
  organisationId: string,
  managerUserId: string
): Promise<string[]> {
  const { data, error } = await client
    .from("user_reporting_lines")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .eq("manager_user_id", managerUserId);

  if (error) {
    console.warn("user_reporting_lines (team):", error.message);
    return [];
  }
  return (data ?? []).map((r) => String((r as { user_id: string }).user_id));
}

/** True if `managerUserId` is the direct manager of `memberUserId` in this org. */
export async function isDirectManagerOf(
  client: SupabaseClient,
  organisationId: string,
  managerUserId: string,
  memberUserId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("user_reporting_lines")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("user_id", memberUserId)
    .eq("manager_user_id", managerUserId)
    .maybeSingle();

  if (error) {
    console.warn("user_reporting_lines (isDirectManagerOf):", error.message);
    return false;
  }
  return data != null;
}

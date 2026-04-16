import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { ensureUserProfile } from "./ensureUserProfile";

export type PrimaryAccountType = "personal" | "organisation";

/**
 * Persist personal-account completion: profile row + primary_account_type = personal.
 */
export async function completePersonalAccountSetup(
  client: SupabaseClient,
  user: User,
): Promise<{ ok: boolean; error: string | null }> {
  const ensured = await ensureUserProfile(client, user);
  if (!ensured.ok) {
    return { ok: false, error: ensured.error ?? "Could not create profile." };
  }
  const email = user.email?.trim() ?? "";
  const { error } = await client.from("profiles").upsert(
    {
      id: user.id,
      email: email || null,
      primary_account_type: "personal",
    },
    { onConflict: "id" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/**
 * User chose workspace-led completion without requiring a membership yet (e.g. pending invite).
 */
export async function completeOrganisationAccountIntent(
  client: SupabaseClient,
  user: User,
): Promise<{ ok: boolean; error: string | null }> {
  const ensured = await ensureUserProfile(client, user);
  if (!ensured.ok) {
    return { ok: false, error: ensured.error ?? "Could not create profile." };
  }
  const email = user.email?.trim() ?? "";
  const { error } = await client.from("profiles").upsert(
    {
      id: user.id,
      email: email || null,
      primary_account_type: "organisation",
    },
    { onConflict: "id" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

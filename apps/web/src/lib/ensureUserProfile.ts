import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

/**
 * Ensure a `profiles` row exists for the auth user (id + email).
 * Safe to call on every sign-in; remote DB may also use an auth trigger.
 */
export async function ensureUserProfile(
  client: SupabaseClient,
  user: User,
): Promise<{ ok: boolean; error: string | null }> {
  const email = user.email?.trim() ?? "";
  const { error } = await client.from("profiles").upsert(
    {
      id: user.id,
      email: email || null,
    },
    { onConflict: "id" },
  );
  if (error) {
    console.warn("[ensureUserProfile]", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

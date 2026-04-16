import type { SupabaseClient } from "@supabase/supabase-js";

export type Email2faGateStatus = {
  mandatory: boolean;
  enabled: boolean;
  sessionValid: boolean;
  /** True when the user must complete enrollment or login OTP before using the app. */
  blocked: boolean;
};

export async function getEmail2faGateStatus(
  client: SupabaseClient,
  userId: string,
): Promise<Email2faGateStatus> {
  const [{ data: mand, error: eM }, { data: sf }, { data: sv, error: eS }] =
    await Promise.all([
      client.rpc("user_requires_mandatory_2fa_for_me"),
      client
        .from("user_second_factor")
        .select("enabled")
        .eq("user_id", userId)
        .maybeSingle(),
      client.rpc("user_second_factor_session_valid"),
    ]);
  if (eM) throw new Error(eM.message);
  if (eS) throw new Error(eS.message);
  const mandatory = mand === true;
  const enabled = Boolean(sf?.enabled);
  const sessionValid = sv === true;
  const blocked = (mandatory && !enabled) || (enabled && !sessionValid);
  return { mandatory, enabled, sessionValid, blocked };
}

import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase/server";

/** One auth lookup per request when used from layout + page. */
export const getServerUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

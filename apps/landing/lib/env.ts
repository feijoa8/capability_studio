/** Supabase project URL (same host as Edge Functions). */
export function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
}

export function getHelpApiUrl(): string {
  const base = getSupabaseUrl();
  return base ? `${base}/functions/v1/help-api` : "";
}

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:5173";
}

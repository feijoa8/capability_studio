/** Required for auth, help chat, and app deep links. SITE_URL is optional (layout has a default metadata base). */
const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type PublicEnvKey = (typeof KEYS)[number];

/** Keys that are unset or empty (trimmed). */
export function getMissingPublicEnvKeys(): PublicEnvKey[] {
  const missing: PublicEnvKey[] = [];
  for (const k of KEYS) {
    if (!process.env[k]?.trim()) missing.push(k);
  }
  return missing;
}

export function hasSupabaseBrowserConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}

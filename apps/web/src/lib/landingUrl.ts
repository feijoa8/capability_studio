/**
 * Public marketing / landing site URL for auth chrome and cross-app links.
 *
 * Resolution order:
 * 1. VITE_LANDING_URL — explicit (recommended for production)
 * 2. Dev: http://localhost:3001 (Next landing default in this repo)
 * 3. Derive from VITE_APP_PUBLIC_URL when hostname is `app.*` → strip `app.` label
 *
 * No trailing slash.
 */
function deriveLandingFromAppPublicUrl(): string | null {
  const raw = import.meta.env.VITE_APP_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host.startsWith("app.")) {
      u.hostname = host.slice(4);
      return u.origin;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function getLandingHref(): string {
  const explicit = import.meta.env.VITE_LANDING_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (import.meta.env.DEV) return "http://localhost:3001";
  const derived = deriveLandingFromAppPublicUrl();
  if (derived) return derived;
  if (import.meta.env.PROD) {
    console.warn(
      "[Capability Studio] VITE_LANDING_URL is unset; set it to your public marketing site so “Back to Home” is correct.",
    );
  }
  return "http://localhost:3001";
}

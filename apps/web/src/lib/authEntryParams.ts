import type { SignupPath } from "./signupPaths";

export type AuthUrlMode = "signin" | "signup" | "forgot";

/** Read ?mode= & ?path= & ?recovered= from the app URL and strip known keys. */
export function consumeAuthEntrySearchParams(): {
  mode: AuthUrlMode | null;
  path: SignupPath | null;
  passwordRecovered: boolean;
} {
  if (typeof window === "undefined") {
    return { mode: null, path: null, passwordRecovered: false };
  }
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get("mode")?.toLowerCase() ?? "";
  const rawPath = params.get("path")?.toLowerCase() ?? "";

  const mode: AuthUrlMode | null =
    rawMode === "signin" || rawMode === "signup" || rawMode === "forgot"
      ? rawMode
      : null;

  const path: SignupPath | null =
    rawPath === "individual" ||
    rawPath === "organisation" ||
    rawPath === "consultant"
      ? rawPath
      : null;

  const passwordRecovered = params.get("recovered") === "1";

  if (mode || path || passwordRecovered) {
    const next = new URLSearchParams(window.location.search);
    next.delete("mode");
    next.delete("path");
    next.delete("recovered");
    const qs = next.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
  }

  return { mode, path, passwordRecovered };
}

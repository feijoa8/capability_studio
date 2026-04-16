import { getAppUrl } from "./env";

export type AppAuthPath = "individual" | "organisation" | "consultant";

/** Join app origin with a path (e.g. `/` → app root where the Vite SPA hosts sign-in). */
function hrefToApp(path: string): string {
  const base = getAppUrl().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** Append auth entry query params consumed by apps/web (`?mode=`, `?path=`). */
function withAuthQuery(
  href: string,
  query: { mode?: "signin" | "signup" | "forgot"; path?: AppAuthPath },
): string {
  const u = new URL(href);
  if (query.mode) u.searchParams.set("mode", query.mode);
  if (query.path) u.searchParams.set("path", query.path);
  return u.toString();
}

/** Login URL: full override, or app root with `mode=signin` for the Vite SPA. */
export function getLoginHref(): string {
  const full = process.env.NEXT_PUBLIC_APP_LOGIN_URL?.trim();
  if (full) return full;
  const path = (process.env.NEXT_PUBLIC_AUTH_LOGIN_PATH ?? "/").trim() || "/";
  const base = hrefToApp(path);
  return withAuthQuery(base, { mode: "signin" });
}

/** Sign-up URL: full override, or app root with `mode=signup` for explicit onboarding entry. */
export function getSignupHref(path?: AppAuthPath): string {
  const full = process.env.NEXT_PUBLIC_APP_SIGNUP_URL?.trim();
  if (full) return full;
  const p = (process.env.NEXT_PUBLIC_AUTH_SIGNUP_PATH ?? "/").trim() || "/";
  const base = hrefToApp(p);
  return withAuthQuery(base, { mode: "signup", ...(path ? { path } : {}) });
}

/** Forgot password: app root with `mode=forgot` (apps/web). */
export function getForgotPasswordHref(): string {
  const full = process.env.NEXT_PUBLIC_APP_FORGOT_PASSWORD_URL?.trim();
  if (full) return full;
  const path = (process.env.NEXT_PUBLIC_AUTH_FORGOT_PATH ?? "/").trim() || "/";
  const base = hrefToApp(path);
  return withAuthQuery(base, { mode: "forgot" });
}

/** Main product (Vite app) entry — opens signed-in experience or sign-in when logged out. */
export function getOpenAppHref(): string {
  const full = process.env.NEXT_PUBLIC_APP_OPEN_URL?.trim();
  if (full) return full;
  return hrefToApp("/");
}

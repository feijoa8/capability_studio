/**
 * Password recovery & future branded auth email (Resend) — central configuration.
 *
 * Recovery emails are sent by Supabase Auth today. To move delivery to Resend
 * (e.g. auth@mail.capability.studio), configure the Supabase project / hooks * in the dashboard; this module only documents the app-side contract.
 *
 * Supabase dashboard:
 * - Add redirect URL: `${publicAppUrl}/auth/reset-password`
 * - Optional: Auth Hook "Send Email" → Resend API with your templates
 *
 * Avoid duplicating long email body copy here — in-app UI is separate from email HTML.
 */

const RECOVERY_PATH = "/auth/reset-password";

/** Planned branded sender (not wired in Phase 3). */
export const RESEND_AUTH_SENDER_LABEL = "Capability Studio";
export const RESEND_AUTH_SENDER_EMAIL = "auth@mail.capability.studio";

export function getRecoveryPath(): string {
  return RECOVERY_PATH;
}

/**
 * Absolute URL Supabase redirects to after the user clicks the reset link.
 * Must be listed under Authentication → URL configuration → Redirect URLs.
 */
export function getPasswordRecoveryRedirectUrl(): string {
  const envBase = import.meta.env.VITE_APP_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (envBase) {
    return `${envBase}${RECOVERY_PATH}`;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${RECOVERY_PATH}`;
  }
  throw new Error(
    "Password recovery needs VITE_APP_PUBLIC_URL at build time, or open the app in a browser so origin can be used.",
  );
}

export type RecoveryConfigStatus = {
  ok: boolean;
  warnings: string[];
};

export function getRecoveryConfigStatus(): RecoveryConfigStatus {
  const warnings: string[] = [];
  if (!import.meta.env.VITE_APP_PUBLIC_URL?.trim()) {
    warnings.push(
      "VITE_APP_PUBLIC_URL is unset — recovery redirect uses the browser origin in dev; set it in production so reset links match your deployed app URL.",
    );
  }
  return { ok: warnings.length === 0, warnings };
}

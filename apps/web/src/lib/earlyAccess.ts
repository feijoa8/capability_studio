/**
 * Mirrors landing `lib/earlyAccess.ts`: production builds default to gated self-sign-up.
 * Set `VITE_PUBLIC_EARLY_ACCESS=false` to allow open registration (e.g. local prod builds).
 */
export function isEarlyAccessAuth(): boolean {
  const raw = import.meta.env.VITE_PUBLIC_EARLY_ACCESS?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return import.meta.env.PROD;
}

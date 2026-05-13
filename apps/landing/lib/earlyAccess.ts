/**
 * Controlled early access: hide public self-registration while keeping sign-in
 * (invited and existing users). Production builds default to gated; override with
 * `NEXT_PUBLIC_EARLY_ACCESS=false` for open registration environments.
 */
export function isEarlyAccessPhase(): boolean {
  const raw = process.env.NEXT_PUBLIC_EARLY_ACCESS?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return process.env.NODE_ENV === "production";
}

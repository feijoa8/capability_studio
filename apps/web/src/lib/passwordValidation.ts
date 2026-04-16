/** Align with sign-up: minimum length8. Extend here if product adds complexity rules. */
export const PASSWORD_MIN_LENGTH = 8;

export function validateNewPassword(password: string): string | null {
  const p = password.trim();
  if (!p) return "Enter a password.";
  if (p.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (p.length > 256) return "Password is too long.";
  return null;
}

export function passwordsMatch(a: string, b: string): boolean {
  return a === b;
}

import type { SupabaseClient } from "@supabase/supabase-js";

const SEND = "auth-send-password-reset-otp";
const VERIFY = "auth-verify-password-reset-otp";
const COMPLETE = "auth-complete-password-reset";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

async function messageFromFunctionsInvokeError(
  invokeError: unknown,
): Promise<string> {
  if (!invokeError || typeof invokeError !== "object") {
    return "Something went wrong. Please try again.";
  }
  const err = invokeError as { message?: string; context?: unknown };
  const genericNon2xx =
    typeof err.message === "string" &&
    /edge function returned a non-2xx status code/i.test(err.message);

  const ctx = err.context;
  if (ctx instanceof Response) {
    try {
      const text = await ctx.text();
      if (text) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (isRecord(parsed)) {
            if (typeof parsed.error === "string" && parsed.error.trim()) {
              return parsed.error.trim();
            }
            if (typeof parsed.message === "string" && parsed.message.trim()) {
              return parsed.message.trim();
            }
          }
        } catch {
          const t = text.trim();
          if (t.length > 0 && t.length < 500) return t;
        }
      }
    } catch {
      /* fallback below */
    }
  }

  if (typeof err.message === "string" && err.message.trim()) {
    if (genericNon2xx) {
      return "The reset service returned an error. Please try again.";
    }
    return err.message.trim();
  }
  return "Something went wrong. Please try again.";
}

function peelError(
  data: unknown,
):
  | { error: string; _tag: "err" }
  | { _tag: "ok"; value: unknown } {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (e) return { error: String(e), _tag: "err" };
  }
  return { _tag: "ok", value: data };
}

export type PasswordResetOtpResponse = {
  ok?: boolean;
  error?: string;
  expiresAt?: string;
  nextResendAt?: string;
};

/**
 * Resend / first send — same `auth-send-password-reset-otp` call (no JWT).
 */
export async function sendPasswordResetOtp(
  client: SupabaseClient,
  email: string,
): Promise<PasswordResetOtpResponse> {
  const { data, error } = await client.functions.invoke(SEND, {
    body: { email: email.trim() },
  });
  if (error) {
    return { error: await messageFromFunctionsInvokeError(error) };
  }
  const p = peelError(data);
  if (p._tag === "err") return { error: p.error };
  return (p.value ?? {}) as PasswordResetOtpResponse;
}

export async function verifyPasswordResetOtp(
  client: SupabaseClient,
  email: string,
  code: string,
): Promise<{ ok: true; resetToken: string } | { ok: false; error: string }> {
  const { data, error } = await client.functions.invoke(VERIFY, {
    body: { email: email.trim(), code },
  });
  if (error) {
    return { ok: false, error: await messageFromFunctionsInvokeError(error) };
  }
  const p = peelError(data);
  if (p._tag === "err") return { ok: false, error: p.error };
  const v = p.value;
  if (
    v &&
    typeof v === "object" &&
    (v as { ok?: boolean }).ok === true &&
    typeof (v as { resetToken?: string }).resetToken === "string" &&
    (v as { resetToken: string }).resetToken
  ) {
    return { ok: true, resetToken: (v as { resetToken: string }).resetToken };
  }
  return { ok: false, error: "Invalid or expired code." };
}

export async function completePasswordReset(
  client: SupabaseClient,
  resetToken: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await client.functions.invoke(COMPLETE, {
    body: { resetToken: resetToken.trim(), newPassword },
  });
  if (error) {
    return { ok: false, error: await messageFromFunctionsInvokeError(error) };
  }
  const p = peelError(data);
  if (p._tag === "err") return { ok: false, error: p.error };
  const v = p.value;
  if (v && typeof v === "object" && (v as { ok?: boolean }).ok === true) {
    return { ok: true };
  }
  return { ok: false, error: "Could not update password. Try again." };
}

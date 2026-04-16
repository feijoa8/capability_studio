import type { SupabaseClient } from "@supabase/supabase-js";

export type EmailOtp2faAction =
  | "start_enrollment"
  | "complete_enrollment"
  | "start_login"
  | "verify_login"
  | "resend"
  | "disable";

export type EmailOtp2faResponse = {
  ok?: boolean;
  error?: string;
  nextResendAt?: string;
  expiresAt?: string;
  verifiedUntil?: string;
};

const FN = "email-otp-2fa";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/** Prefer JSON body `error` / `message` from Edge Function responses; avoid raw non-2xx noise. */
async function messageFromFunctionsInvokeError(invokeError: unknown): Promise<string> {
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
      /* use fallback below */
    }
  }

  if (typeof err.message === "string" && err.message.trim()) {
    if (genericNon2xx) {
      return "The verification service returned an error. Please try again.";
    }
    return err.message.trim();
  }
  return "Something went wrong. Please try again.";
}

export async function invokeEmailOtp2fa(
  client: SupabaseClient,
  body: {
    action: EmailOtp2faAction;
    code?: string;
    purpose?: "enroll" | "login";
  },
): Promise<EmailOtp2faResponse> {
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) {
    return { error: sessionError.message };
  }
  const accessToken = session?.access_token;
  if (!accessToken) {
    return {
      error:
        "No active session. Sign in again, then retry two-factor authentication.",
    };
  }

  const { data, error } = await client.functions.invoke(FN, {
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (error) {
    return { error: await messageFromFunctionsInvokeError(error) };
  }

  if (data && typeof data === "object" && "error" in data && data.error) {
    return { error: String((data as { error: string }).error) };
  }
  return (data ?? {}) as EmailOtp2faResponse;
}

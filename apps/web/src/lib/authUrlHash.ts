/** Parse Supabase auth fragments returned on redirect (recovery, errors). */

export type HashAuthPayload = {
  access_token: string | null;
  refresh_token: string | null;
  type: string | null;
  error: string | null;
  error_code: string | null;
  error_description: string | null;
};

export function parseAuthHashParams(): HashAuthPayload {
  if (typeof window === "undefined") {
    return {
      access_token: null,
      refresh_token: null,
      type: null,
      error: null,
      error_code: null,
      error_description: null,
    };
  }
  const raw = window.location.hash?.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash ?? "";
  const params = new URLSearchParams(raw);
  return {
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    type: params.get("type"),
    error: params.get("error"),
    error_code: params.get("error_code"),
    error_description: params.get("error_description"),
  };
}

export function hashIndicatesRecoveryTokens(): boolean {
  const p = parseAuthHashParams();
  return p.type === "recovery" && Boolean(p.access_token);
}

export function hashIndicatesAuthError(): boolean {
  return Boolean(parseAuthHashParams().error);
}

/** Remove hash from URL after reading (optional cleanup). */
export function stripAuthHashFromUrl(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", pathname + search);
}

export function humanizeAuthHashError(payload: HashAuthPayload): {
  title: string;
  detail: string;
} {
  const code = (payload.error_code ?? "").toLowerCase();
  const rawDesc = (payload.error_description ?? "").replace(/\+/g, " ");
  let desc = rawDesc.trim();
  try {
    desc = decodeURIComponent(rawDesc).trim();
  } catch {
    /* ignore malformed percent-encoding */
  }

  if (code === "otp_expired" || /expired/i.test(desc)) {
    return {
      title: "This reset link has expired",
      detail:
        "Request a new password reset email and use the latest link. Older links stop working for security.",
    };
  }
  if (code === "access_denied" || payload.error === "access_denied") {
    return {
      title: "This reset link could not be used",
      detail:
        desc ||
        "The link may have expired, already been used, or is invalid. Request a new reset email.",
    };
  }
  if (payload.error || desc) {
    return {
      title: "We could not open this reset link",
      detail: desc || "Try requesting a new password reset from the sign-in page.",
    };
  }
  return {
    title: "Something went wrong with this link",
    detail: "Request a new password reset or sign in if you already updated your password.",
  };
}

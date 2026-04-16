import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { getEmail2faGateStatus } from "../../lib/email2faGateStatus";
import { invokeEmailOtp2fa } from "../../lib/emailOtp2faClient";
import { AuthRecoveryChrome } from "./PasswordRecoveryViews";
import {
  bg,
  border,
  brandLime,
  errorColor,
  mutedColor,
  panelShell,
  text,
} from "../hub/hubTheme";

type Props = {
  session: Session;
  children: (userEmail: string) => React.ReactNode;
};

export function TwoFactorGate({ session, children }: Props) {
  const uid = session.user.id;
  const email = session.user.email ?? "";

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mandatory, setMandatory] = useState(false);

  const [gate, setGate] = useState<"enroll" | "challenge" | "none">("none");
  const [localError, setLocalError] = useState<string | null>(null);
  const [localInfo, setLocalInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [enrollCode, setEnrollCode] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [nextResendAt, setNextResendAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const enrollKickoff = useRef(false);
  const loginKickoff = useRef(false);

  const loadState = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setLocalError(null);
    try {
      const st = await getEmail2faGateStatus(supabase, uid);
      setMandatory(st.mandatory);
      if (st.mandatory && !st.enabled) {
        setGate("enroll");
      } else if (st.enabled && !st.sessionValid) {
        setGate("challenge");
      } else {
        setGate("none");
      }
    } catch (e) {
      setLoadFailed(true);
      setLocalError(e instanceof Error ? e.message : String(e));
      setGate("none");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (nextResendAt == null || nextResendAt <= Date.now()) return;
    const t = window.setInterval(() => setTick((k) => k + 1), 1000);
    return () => window.clearInterval(t);
  }, [nextResendAt, tick]);

  useEffect(() => {
    if (loading || gate !== "enroll" || enrollKickoff.current) return;
    enrollKickoff.current = true;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setLocalError(null);
      const out = await invokeEmailOtp2fa(supabase, {
        action: "start_enrollment",
      });
      setBusy(false);
      if (cancelled) return;
      if (out.error) {
        setLocalError(out.error);
        enrollKickoff.current = false;
        return;
      }
      if (out.nextResendAt) {
        setNextResendAt(new Date(out.nextResendAt).getTime());
      }
      setLocalInfo("We sent a code to your email. Enter it below to finish.");
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, gate]);

  useEffect(() => {
    if (loading || gate !== "challenge" || loginKickoff.current) return;
    loginKickoff.current = true;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setLocalError(null);
      const out = await invokeEmailOtp2fa(supabase, { action: "start_login" });
      setBusy(false);
      if (cancelled) return;
      if (out.error) {
        setLocalError(out.error);
        loginKickoff.current = false;
        return;
      }
      if (out.nextResendAt) {
        setNextResendAt(new Date(out.nextResendAt).getTime());
      }
      setLocalInfo("We sent a sign-in code to your email address.");
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, gate]);

  async function handleCompleteEnroll(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setBusy(true);
    const out = await invokeEmailOtp2fa(supabase, {
      action: "complete_enrollment",
      code: enrollCode.replace(/\D/g, ""),
    });
    setBusy(false);
    if (out.error) {
      setLocalError(out.error);
      return;
    }
    setLocalInfo("Two-factor authentication is on.");
    setGate("none");
    enrollKickoff.current = false;
    loginKickoff.current = false;
    await loadState();
  }

  async function handleVerifyLogin(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setBusy(true);
    const out = await invokeEmailOtp2fa(supabase, {
      action: "verify_login",
      code: loginCode.replace(/\D/g, ""),
    });
    setBusy(false);
    if (out.error) {
      setLocalError(out.error);
      return;
    }
    setGate("none");
    loginKickoff.current = false;
    await loadState();
  }

  async function handleResend(purpose: "enroll" | "login") {
    setLocalError(null);
    if (nextResendAt != null && nextResendAt > Date.now()) return;
    setBusy(true);
    const out = await invokeEmailOtp2fa(supabase, { action: "resend", purpose });
    setBusy(false);
    if (out.error) {
      setLocalError(out.error);
      if (out.nextResendAt) {
        setNextResendAt(new Date(out.nextResendAt).getTime());
      }
      return;
    }
    if (out.nextResendAt) {
      setNextResendAt(new Date(out.nextResendAt).getTime());
    }
    setLocalInfo("A new code was sent.");
  }

  const resendWaitSec =
    nextResendAt != null && nextResendAt > Date.now()
      ? Math.ceil((nextResendAt - Date.now()) / 1000)
      : 0;

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    fontSize: 16,
    letterSpacing: "0.2em",
    textAlign: "center",
    color: text,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    boxSizing: "border-box",
  };

  if (loading) {
    return (
      <AuthRecoveryChrome>
        <p style={{ color: mutedColor }}>Checking your security settings…</p>
      </AuthRecoveryChrome>
    );
  }

  if (loadFailed) {
    return (
      <AuthRecoveryChrome>
        <div style={{ ...panelShell, padding: 20 }}>
          <p style={{ color: errorColor, margin: 0 }}>
            {localError ?? "We couldn't load your two-factor status."}
          </p>
          <p style={{ color: mutedColor, fontSize: 14, marginTop: 12 }}>
            Try again, or sign out and sign back in.
          </p>
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => void loadState()}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: bg,
                color: text,
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: "transparent",
                color: mutedColor,
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </AuthRecoveryChrome>
    );
  }

  if (gate === "enroll") {
    return (
      <AuthRecoveryChrome>
        <div style={{ ...panelShell, padding: 22 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px", color: text }}>
            Set up two-factor authentication
          </h1>
          <p style={{ color: mutedColor, fontSize: 14, lineHeight: 1.55, margin: "0 0 18px" }}>
            {mandatory
              ? "Your role requires two-factor sign-in. Confirm this email with the one-time code we send you."
              : "Add email one-time codes for stronger account protection."}
          </p>
          {localInfo ? (
            <p style={{ color: "#8fd9a8", fontSize: 14, margin: "0 0 14px" }}>{localInfo}</p>
          ) : null}
          {busy && !enrollCode ? (
            <p style={{ color: mutedColor, fontSize: 14 }}>Sending code…</p>
          ) : null}
          <form onSubmit={handleCompleteEnroll} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              6-digit code
              <input
                value={enrollCode}
                onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                required
                maxLength={6}
                style={inputStyle}
              />
            </label>
            <button
              type="submit"
              disabled={busy || enrollCode.length !== 6}
              style={{
                padding: "10px 14px",
                fontSize: 15,
                fontWeight: 600,
                color: "#0a0c10",
                background: brandLime,
                border: "none",
                borderRadius: 8,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Verifying…" : "Confirm and enable"}
            </button>
          </form>
          {localError ? (
            <p style={{ color: errorColor, fontSize: 14, marginTop: 12 }}>{localError}</p>
          ) : null}
          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              disabled={busy || resendWaitSec > 0}
              onClick={() => void handleResend("enroll")}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                color: mutedColor,
                background: "transparent",
                border: `1px solid ${border}`,
                borderRadius: 8,
                cursor: resendWaitSec > 0 ? "not-allowed" : "pointer",
              }}
            >
              {resendWaitSec > 0 ? `Resend in ${resendWaitSec}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                color: mutedColor,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </AuthRecoveryChrome>
    );
  }

  if (gate === "challenge") {
    return (
      <AuthRecoveryChrome>
        <div style={{ ...panelShell, padding: 22 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px", color: text }}>
            Verify it&apos;s you
          </h1>
          <p style={{ color: mutedColor, fontSize: 14, lineHeight: 1.55, margin: "0 0 18px" }}>
            Enter the code from your email to finish signing in.
          </p>
          {localInfo ? (
            <p style={{ color: "#8fd9a8", fontSize: 14, margin: "0 0 14px" }}>{localInfo}</p>
          ) : null}
          {busy && !loginCode ? (
            <p style={{ color: mutedColor, fontSize: 14 }}>Sending code…</p>
          ) : null}
          <form onSubmit={handleVerifyLogin} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              6-digit code
              <input
                value={loginCode}
                onChange={(e) => setLoginCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                required
                maxLength={6}
                style={inputStyle}
              />
            </label>
            <button
              type="submit"
              disabled={busy || loginCode.length !== 6}
              style={{
                padding: "10px 14px",
                fontSize: 15,
                fontWeight: 600,
                color: "#0a0c10",
                background: brandLime,
                border: "none",
                borderRadius: 8,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </form>
          {localError ? (
            <p style={{ color: errorColor, fontSize: 14, marginTop: 12 }}>{localError}</p>
          ) : null}
          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              disabled={busy || resendWaitSec > 0}
              onClick={() => void handleResend("login")}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                color: mutedColor,
                background: "transparent",
                border: `1px solid ${border}`,
                borderRadius: 8,
                cursor: resendWaitSec > 0 ? "not-allowed" : "pointer",
              }}
            >
              {resendWaitSec > 0 ? `Resend in ${resendWaitSec}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                color: mutedColor,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </AuthRecoveryChrome>
    );
  }

  return <>{children(email)}</>;
}

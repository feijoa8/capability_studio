import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { getEmail2faGateStatus } from "../lib/email2faGateStatus";
import { invokeEmailOtp2fa } from "../lib/emailOtp2faClient";
import {
  btnPrimary,
  errorColor,
  mutedColor,
  surface,
  text,
  border,
  bg,
} from "./hub/hubTheme";

type Props = {
  userId: string;
  onChanged?: () => void;
};

export function ProfileSecurity2fa({ userId, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [mandatory, setMandatory] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [sessionValid, setSessionValid] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showEnroll, setShowEnroll] = useState(false);
  const [code, setCode] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const st = await getEmail2faGateStatus(supabase, userId);
      setMandatory(st.mandatory);
      setEnabled(st.enabled);
      setSessionValid(st.sessionValid);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startOptionalEnroll() {
    setErr(null);
    setMsg(null);
    setBusy(true);
    const out = await invokeEmailOtp2fa(supabase, { action: "start_enrollment" });
    setBusy(false);
    if (out.error) {
      setErr(out.error);
      return;
    }
    setShowEnroll(true);
    setMsg("Enter the code from your email.");
  }

  async function completeEnroll() {
    setErr(null);
    setBusy(true);
    const out = await invokeEmailOtp2fa(supabase, {
      action: "complete_enrollment",
      code: code.replace(/\D/g, ""),
    });
    setBusy(false);
    if (out.error) {
      setErr(out.error);
      return;
    }
    setShowEnroll(false);
    setCode("");
    setMsg("Two-factor authentication is on.");
    setEnabled(true);
    setSessionValid(true);
    onChanged?.();
    await refresh();
  }

  async function disable2fa() {
    if (mandatory) return;
    setErr(null);
    setBusy(true);
    const out = await invokeEmailOtp2fa(supabase, { action: "disable" });
    setBusy(false);
    if (out.error) {
      setErr(out.error);
      return;
    }
    setMsg("Two-factor authentication is off.");
    onChanged?.();
    await refresh();
  }

  const card = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  const sectionHeading = {
    margin: "0 0 12px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: mutedColor,
  };

  if (loading) {
    return (
      <div style={card}>
        <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={card}>
      <p style={sectionHeading}>Sign-in security</p>
      <p style={{ margin: "0 0 8px", fontSize: 14, color: text }}>
        Method: <strong>Email one-time code</strong>
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>
        {mandatory
          ? "Your role requires two-factor authentication. Turning it off needs a policy change."
          : enabled
            ? "Two-factor is on. Sign-ins will ask for a code sent to your email."
            : "Optional: turn on two-factor for stronger protection."}
      </p>
      {enabled ? (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#8fd9a8" }}>
          Status: enabled
          {sessionValid ? " · verified this session" : ""}
        </p>
      ) : (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
          Status: not enabled
        </p>
      )}
      {msg ? (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#8fd9a8" }}>{msg}</p>
      ) : null}
      {err ? (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: errorColor }}>{err}</p>
      ) : null}

      {!enabled && !showEnroll && !mandatory ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startOptionalEnroll()}
          style={{ ...btnPrimary, fontSize: 13 }}
        >
          Enable email two-factor
        </button>
      ) : null}

      {!enabled && !showEnroll && mandatory ? (
        <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
          Finish setup using the security screen shown right after you sign in.
        </p>
      ) : null}

      {showEnroll && !enabled ? (
        <div style={{ display: "grid", gap: 10, maxWidth: 280 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            style={{
              padding: "10px 12px",
              fontSize: 15,
              color: text,
              backgroundColor: bg,
              border: `1px solid ${border}`,
              borderRadius: 8,
            }}
          />
          <button
            type="button"
            disabled={busy || code.length !== 6}
            onClick={() => void completeEnroll()}
            style={{ ...btnPrimary, fontSize: 13 }}
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setShowEnroll(false);
              setCode("");
              setMsg(null);
            }}
            style={{
              fontSize: 12,
              color: mutedColor,
              background: "none",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {enabled && !mandatory ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void disable2fa()}
          style={{
            marginTop: 8,
            padding: "8px 14px",
            fontSize: 13,
            color: errorColor,
            background: "transparent",
            border: `1px solid ${border}`,
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Turn off two-factor
        </button>
      ) : null}
    </div>
  );
}

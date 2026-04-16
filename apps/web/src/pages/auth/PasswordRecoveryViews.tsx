import type { CSSProperties, FormEvent } from "react";
import {
  accent,
  bg,
  border,
  brandLime,
  errorColor,
  mutedColor,
  panelShell,
  text,
} from "../hub/hubTheme";
import {
  PASSWORD_MIN_LENGTH,
  passwordsMatch,
  validateNewPassword,
} from "../../lib/passwordValidation";
import { webBrandAssets } from "../../lib/brandAssets";
import { getLandingHref } from "../../lib/landingUrl";

const linkStyle: CSSProperties = {
  color: accent,
  fontSize: 14,
  fontWeight: 500,
  textDecoration: "none",
  cursor: "pointer",
  background: "none",
  border: "none",
  padding: 0,
  fontFamily: "inherit",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 15,
  color: text,
  backgroundColor: bg,
  border: `1px solid ${border}`,
  borderRadius: 8,
  boxSizing: "border-box",
};

const btnPrimary: CSSProperties = {
  padding: "10px 14px",
  fontSize: 15,
  fontWeight: 600,
  color: "#0a0c10",
  background: brandLime,
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

const btnGhost: CSSProperties = {
  padding: "8px 12px",
  fontSize: 14,
  color: mutedColor,
  background: "transparent",
  border: `1px solid ${border}`,
  borderRadius: 8,
  cursor: "pointer",
};

export function AuthRecoveryChrome({ children }: { children: React.ReactNode }) {
  const landingHref = getLandingHref();
  const backToHomeStyle: CSSProperties = {
    fontSize: 13,
    color: mutedColor,
    textDecoration: "none",
    display: "inline-block",
    marginBottom: 16,
  };
  return (
    <div
      style={{
        minHeight: "100vh",
        background: bg,
        color: text,
        padding: "32px 20px",
        boxSizing: "border-box",
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <a href={landingHref} rel="noopener noreferrer" style={backToHomeStyle}>
          ← Back to Home
        </a>
        <a
          href={landingHref}
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
            color: text,
            marginBottom: 8,
          }}
        >
          <img
            src={webBrandAssets.logoMark}
            alt=""
            width={36}
            height={36}
            decoding="async"
          />
          <img
            src={webBrandAssets.logoWordmark}
            alt="Capability Studio"
            width={200}
            height={28}
            decoding="async"
            style={{ width: "auto", maxWidth: "min(100%, 220px)", height: "auto" }}
          />
        </a>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          Feijoa8
        </p>
        {children}
      </div>
    </div>
  );
}

type ForgotProps = {
  email: string;
  onEmailChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  error: string | null;
  info: string | null;
  onBackToSignIn: () => void;
};

export function ForgotPasswordForm({
  email,
  onEmailChange,
  onSubmit,
  loading,
  error,
  info,
  onBackToSignIn,
}: ForgotProps) {
  return (
    <div style={{ ...panelShell, padding: "22px 20px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
        Reset your password
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
        Enter the email you use for Capability Studio. If an account exists, we&apos;ll send a
        link to reset your password.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
            disabled={loading}
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={loading} style={btnPrimary}>
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>
      {error ? (
        <p style={{ color: errorColor, marginTop: 14, fontSize: 14, lineHeight: 1.5 }}>
          {error}
        </p>
      ) : null}
      {info ? (
        <p style={{ color: "#8fd9a8", marginTop: 14, fontSize: 14, lineHeight: 1.5 }}>
          {info}
        </p>
      ) : null}
      <p style={{ marginTop: 20, marginBottom: 0 }}>
        <button type="button" onClick={onBackToSignIn} style={linkStyle}>
          ← Back to sign in
        </button>
      </p>
    </div>
  );
}

type ResetProps = {
  newPassword: string;
  confirmPassword: string;
  onNewPasswordChange: (v: string) => void;
  onConfirmPasswordChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  error: string | null;
  onRequestNewLink: () => void;
};

export function ResetPasswordForm({
  newPassword,
  confirmPassword,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  loading,
  error,
  onRequestNewLink,
}: ResetProps) {
  return (
    <div style={{ ...panelShell, padding: "22px 20px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
        Choose a new password
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
        Your account is verified for this reset. Use at least {PASSWORD_MIN_LENGTH} characters.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => onNewPasswordChange(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
            disabled={loading}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => onConfirmPasswordChange(e.target.value)}
            required
            minLength={PASSWORD_MIN_LENGTH}
            disabled={loading}
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={loading} style={btnPrimary}>
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>
      {error ? (
        <p style={{ color: errorColor, marginTop: 14, fontSize: 14, lineHeight: 1.5 }}>
          {error}
        </p>
      ) : null}
      <p style={{ marginTop: 18, marginBottom: 0, fontSize: 13, color: mutedColor }}>
        Link not working?{" "}
        <button type="button" onClick={onRequestNewLink} style={linkStyle}>
          Request a new reset email
        </button>
      </p>
    </div>
  );
}

type MessageProps = {
  title: string;
  detail: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
};

export function RecoveryMessageCard({
  title,
  detail,
  primaryAction,
  secondaryAction,
}: MessageProps) {
  return (
    <div style={{ ...panelShell, padding: "22px 20px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>{title}</h1>
      <p style={{ margin: "0 0 22px", fontSize: 14, color: mutedColor, lineHeight: 1.55 }}>
        {detail}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {primaryAction ? (
          <button type="button" onClick={primaryAction.onClick} style={btnPrimary}>
            {primaryAction.label}
          </button>
        ) : null}
        {secondaryAction ? (
          <button type="button" onClick={secondaryAction.onClick} style={btnGhost}>
            {secondaryAction.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { passwordsMatch, validateNewPassword };

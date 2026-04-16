import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { consumeAuthEntrySearchParams } from "./lib/authEntryParams";
import { ensureUserProfile } from "./lib/ensureUserProfile";
import type { SignupPath } from "./lib/signupPaths";
import {
  getPasswordRecoveryRedirectUrl,
  getRecoveryConfigStatus,
  getRecoveryPath,
} from "./lib/authRecoveryConfig";
import {
  hashIndicatesAuthError,
  hashIndicatesRecoveryTokens,
  humanizeAuthHashError,
  parseAuthHashParams,
  stripAuthHashFromUrl,
} from "./lib/authUrlHash";
import { Post2FaApp } from "./pages/auth/Post2FaApp";
import { TwoFactorGate } from "./pages/auth/TwoFactorGate";
import { getEmail2faGateStatus } from "./lib/email2faGateStatus";
import {
  AuthRecoveryChrome,
  ForgotPasswordForm,
  RecoveryMessageCard,
  ResetPasswordForm,
  passwordsMatch,
  validateNewPassword,
} from "./pages/auth/PasswordRecoveryViews";
import { mutedColor, text } from "./pages/hub/hubTheme";

function normalizeRecoveryUrlPath(): void {
  if (typeof window === "undefined") return;
  if (!hashIndicatesRecoveryTokens()) return;
  const path = getRecoveryPath();
  if (window.location.pathname === path) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.origin}${path}${window.location.hash}`,
  );
}
normalizeRecoveryUrlPath();

function isRecoveryRoute(): boolean {
  return typeof window !== "undefined" && window.location.pathname === getRecoveryPath();
}

function initialHashError():
  | ReturnType<typeof humanizeAuthHashError>
  | null {
  if (typeof window === "undefined") return null;
  const p = parseAuthHashParams();
  if (!p.error) return null;
  return humanizeAuthHashError(p);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInPane, setSignInPane] = useState<"credentials" | "forgot">("credentials");
  const [signupPath, setSignupPath] = useState<SignupPath>("individual");
  const [organisationName, setOrganisationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [passwordRecoveryFlow, setPasswordRecoveryFlow] = useState(() => {
    if (typeof window === "undefined") return false;
    return hashIndicatesRecoveryTokens() && !hashIndicatesAuthError();
  });
  const [recoveryHashError] = useState(initialHashError);
  const [passwordRecoveredBanner, setPasswordRecoveredBanner] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotInfo, setForgotInfo] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const urlParamsConsumed = useRef(false);

  useEffect(() => {
    const cfg = getRecoveryConfigStatus();
    for (const w of cfg.warnings) console.warn(`[auth recovery] ${w}`);
  }, []);

  useEffect(() => {
    if (!urlParamsConsumed.current) {
      urlParamsConsumed.current = true;
      const { mode: qMode, path: qPath, passwordRecovered } =
        consumeAuthEntrySearchParams();
      if (passwordRecovered) {
        setPasswordRecoveredBanner(true);
      }
      if (qMode === "signup" || qMode === "signin") {
        setMode(qMode);
        setSignInPane("credentials");
      }
      if (qMode === "forgot") {
        setMode("signin");
        setSignInPane("forgot");
      }
      if (qPath) {
        setSignupPath(qPath);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryFlow(true);
      }
      if (event === "SIGNED_OUT") {
        setPasswordRecoveryFlow(false);
      }
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user || passwordRecoveryFlow) return;

    let cancelled = false;

    (async () => {
      try {
        const st = await getEmail2faGateStatus(supabase, session.user.id);
        if (cancelled || st.blocked) return;
      } catch {
        if (cancelled) return;
        return;
      }

      await ensureUserProfile(supabase, session.user);
      if (cancelled) return;

      const meta = session.user.user_metadata ?? {};
      const intent = meta.signup_intent as SignupPath | undefined;

      if (intent === "organisation") {
        const name = (meta.pending_organisation_name as string | undefined)?.trim();
        if (!name) {
          await supabase.auth.updateUser({
            data: { signup_intent: null, pending_organisation_name: null },
          });
          return;
        }
        const { error } = await supabase.rpc("register_workspace_as_owner", {
          p_organisation_name: name,
        });
        await supabase.auth.updateUser({
          data: { signup_intent: null, pending_organisation_name: null },
        });
        if (cancelled) return;
        if (error) {
          setAuthNotice(
            `We could not finish workspace setup: ${error.message}. If you already have a workspace, sign out and back in, or contact support.`,
          );
          return;
        }
        window.location.reload();
        return;
      }

      if (intent === "consultant") {
        const uid = session.user.id;
        const { data: existing } = await supabase
          .from("consultant_requests")
          .select("id")
          .eq("user_id", uid)
          .maybeSingle();
        if (cancelled) return;
        if (existing) {
          await supabase.auth.updateUser({
            data: { signup_intent: null },
          });
          return;
        }
        const { error } = await supabase.from("consultant_requests").insert({
          user_id: uid,
          status: "pending",
        });
        await supabase.auth.updateUser({ data: { signup_intent: null } });
        if (cancelled) return;
        if (error) {
          setAuthNotice(
            `Your consultant request could not be recorded: ${error.message}. Try again from My Profile or contact support.`,
          );
        }
        return;
      }

      if (intent === "individual") {
        await supabase.auth.updateUser({ data: { signup_intent: null } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, passwordRecoveryFlow]);

  async function handleSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthError("");
    setAuthInfo("");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) setAuthError(error.message);
  }

  async function handleSignUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthError("");
    setAuthInfo("");

    if (signupPath === "organisation") {
      const on = organisationName.trim();
      if (on.length < 2) {
        setAuthError("Enter an organisation name (at least 2 characters).");
        return;
      }
      if (on.length > 200) {
        setAuthError("Organisation name is too long.");
        return;
      }
    }

    const meta: Record<string, string> = {
      signup_intent: signupPath,
    };
    if (signupPath === "organisation") {
      meta.pending_organisation_name = organisationName.trim();
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: meta },
    });

    if (error) {
      setAuthError(error.message);
      return;
    }

    setAuthInfo(
      "Check your email to confirm your account, then sign in. If email confirmation is disabled in your project, you can continue in the app now.",
    );
  }

  async function handleForgotSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setForgotError(null);
    setForgotInfo(null);
    const trimmed = forgotEmail.trim();
    if (!trimmed) {
      setForgotError("Enter your email address.");
      return;
    }
    setForgotLoading(true);
    try {
      let redirectTo: string;
      try {
        redirectTo = getPasswordRecoveryRedirectUrl();
      } catch (err) {
        setForgotError(
          err instanceof Error ? err.message : "Recovery URL is not configured.",
        );
        setForgotLoading(false);
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo,
      });
      if (error) {
        setForgotError(error.message);
        setForgotLoading(false);
        return;
      }
      setForgotInfo(
        "If an account exists for that email, we sent a link to reset your password. Check your inbox and spam folder.",
      );
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleResetPasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResetError(null);
    const pw = resetPassword;
    const v = validateNewPassword(pw);
    if (v) {
      setResetError(v);
      return;
    }
    if (!passwordsMatch(pw, resetConfirm)) {
      setResetError("Passwords do not match.");
      return;
    }
    setResetLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setResetLoading(false);
    if (error) {
      if (/session|jwt|expired|invalid/i.test(error.message)) {
        setResetError(
          "This reset session is no longer valid. The link may have expired or already been used. Request a new reset email.",
        );
      } else {
        setResetError(error.message);
      }
      return;
    }
    stripAuthHashFromUrl();
    await supabase.auth.signOut();
    window.location.assign("/?mode=signin&recovered=1");
  }

  function goRequestNewResetEmail() {
    stripAuthHashFromUrl();
    void supabase.auth.signOut();
    window.location.assign("/?mode=forgot");
  }

  function goSignInHome() {
    stripAuthHashFromUrl();
    window.location.assign("/?mode=signin");
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    fontSize: 15,
    color: text,
    backgroundColor: "#0c0f14",
    border: "1px solid #2a3240",
    borderRadius: 8,
    boxSizing: "border-box",
  };

  if (authReady && session && passwordRecoveryFlow) {
    return (
      <AuthRecoveryChrome>
        <ResetPasswordForm
          newPassword={resetPassword}
          confirmPassword={resetConfirm}
          onNewPasswordChange={setResetPassword}
          onConfirmPasswordChange={setResetConfirm}
          onSubmit={handleResetPasswordSubmit}
          loading={resetLoading}
          error={resetError}
          onRequestNewLink={goRequestNewResetEmail}
        />
      </AuthRecoveryChrome>
    );
  }

  if (authReady && session && !passwordRecoveryFlow) {
    return (
      <>
        {authNotice ? (
          <div
            role="alert"
            style={{
              margin: 0,
              padding: "12px 20px",
              fontSize: 14,
              background: "#2a1f08",
              color: "#f0e6d8",
              borderBottom: "1px solid #5c4018",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <span style={{ lineHeight: 1.5 }}>{authNotice}</span>
            <button
              type="button"
              onClick={() => setAuthNotice(null)}
              style={{
                flexShrink: 0,
                padding: "4px 10px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        ) : null}
        <TwoFactorGate session={session}>
          {(email) => <Post2FaApp userEmail={email} />}
        </TwoFactorGate>
      </>
    );
  }

  if (!authReady) {
    if (isRecoveryRoute()) {
      return (
        <AuthRecoveryChrome>
          <p style={{ color: mutedColor, fontSize: 15 }}>Opening your reset link…</p>
        </AuthRecoveryChrome>
      );
    }
    return (
      <AuthRecoveryChrome>
        <p style={{ color: mutedColor, fontSize: 15 }}>Loading…</p>
      </AuthRecoveryChrome>
    );
  }

  if (recoveryHashError && isRecoveryRoute()) {
    return (
      <AuthRecoveryChrome>
        <RecoveryMessageCard
          title={recoveryHashError.title}
          detail={recoveryHashError.detail}
          primaryAction={{
            label: "Request a new reset email",
            onClick: goRequestNewResetEmail,
          }}
          secondaryAction={{ label: "Back to sign in", onClick: goSignInHome }}
        />
      </AuthRecoveryChrome>
    );
  }

  if (isRecoveryRoute() && !recoveryHashError && !session) {
    return (
      <AuthRecoveryChrome>
        <RecoveryMessageCard
          title="This reset link is not valid"
          detail="The link may be incomplete, expired, or already used. Request a new password reset and open the latest email we send you."
          primaryAction={{
            label: "Request a new reset email",
            onClick: goRequestNewResetEmail,
          }}
          secondaryAction={{ label: "Back to sign in", onClick: goSignInHome }}
        />
      </AuthRecoveryChrome>
    );
  }

  if (signInPane === "forgot") {
    return (
      <AuthRecoveryChrome>
        <ForgotPasswordForm
          email={forgotEmail}
          onEmailChange={setForgotEmail}
          onSubmit={handleForgotSubmit}
          loading={forgotLoading}
          error={forgotError}
          info={forgotInfo}
          onBackToSignIn={() => {
            setSignInPane("credentials");
            setForgotError(null);
            setForgotInfo(null);
          }}
        />
      </AuthRecoveryChrome>
    );
  }

  return (
    <AuthRecoveryChrome>
      <div
        style={{
          padding: "22px 20px",
          borderRadius: 10,
          backgroundColor: "#151a22",
          border: "1px solid #2a3240",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setAuthError("");
              setAuthInfo("");
            }}
            style={{
              fontWeight: mode === "signin" ? 600 : 400,
              padding: "6px 12px",
              cursor: "pointer",
              background: mode === "signin" ? "#1a2029" : "transparent",
              border: "1px solid #2a3240",
              borderRadius: 8,
              color: text,
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setAuthError("");
              setAuthInfo("");
            }}
            style={{
              fontWeight: mode === "signup" ? 600 : 400,
              padding: "6px 12px",
              cursor: "pointer",
              background: mode === "signup" ? "#1a2029" : "transparent",
              border: "1px solid #2a3240",
              borderRadius: 8,
              color: text,
            }}
          >
            Create account
          </button>
        </div>

        {passwordRecoveredBanner ? (
          <p
            style={{
              color: "#8fd9a8",
              margin: "0 0 16px",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Your password was updated. Sign in with your new password.
          </p>
        ) : null}

        {mode === "signin" ? (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 20, color: text }}>
              Sign in
            </h1>
            <form
              onSubmit={handleSignIn}
              style={{ display: "grid", gap: 12, maxWidth: 360 }}
            >
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={inputStyle}
              />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={inputStyle}
              />
              <button
                type="submit"
                style={{
                  padding: "10px 14px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#0a0c10",
                  background: "#c4f542",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Sign in
              </button>
            </form>
            <p style={{ marginTop: 14, marginBottom: 0 }}>
              <button
                type="button"
                onClick={() => {
                  setSignInPane("forgot");
                  setForgotEmail(email.trim());
                  setForgotError(null);
                  setForgotInfo(null);
                }}
                style={{
                  color: "#6eb0f0",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Forgot password?
              </button>
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12, color: text }}>
              Create account
            </h1>
            <p style={{ fontSize: 14, color: mutedColor, marginBottom: 16 }}>
              Choose how you&apos;re joining. You can complete details after your account
              exists.
            </p>
            <div
              style={{
                display: "grid",
                gap: 8,
                marginBottom: 16,
                fontSize: 14,
                color: mutedColor,
              }}
            >
              <label style={{ display: "flex", gap: 8, cursor: "pointer", color: text }}>
                <input
                  type="radio"
                  name="path"
                  checked={signupPath === "individual"}
                  onChange={() => setSignupPath("individual")}
                />
                Individual — personal account (no organisation required)
              </label>
              <label style={{ display: "flex", gap: 8, cursor: "pointer", color: text }}>
                <input
                  type="radio"
                  name="path"
                  checked={signupPath === "organisation"}
                  onChange={() => setSignupPath("organisation")}
                />
                Organisation — create a workspace (you become company owner)
              </label>
              <label style={{ display: "flex", gap: 8, cursor: "pointer", color: text }}>
                <input
                  type="radio"
                  name="path"
                  checked={signupPath === "consultant"}
                  onChange={() => setSignupPath("consultant")}
                />
                Learning consultant — request access (approvals required)
              </label>
            </div>
            {signupPath === "organisation" ? (
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: mutedColor,
                  }}
                >
                  Organisation / workspace name
                  <input
                    type="text"
                    autoComplete="organization"
                    placeholder="e.g. Acme Ltd"
                    value={organisationName}
                    onChange={(e) => setOrganisationName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={200}
                    style={inputStyle}
                  />
                </label>
                <p style={{ fontSize: 13, color: mutedColor, margin: "8px 0 0" }}>
                  We&apos;ll create the organisation and set you as company owner after your
                  account is active.
                </p>
              </div>
            ) : null}
            <form
              onSubmit={handleSignUp}
              style={{ display: "grid", gap: 12, maxWidth: 360 }}
            >
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={inputStyle}
              />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                style={inputStyle}
              />
              {signupPath === "consultant" ? (
                <p style={{ fontSize: 13, color: mutedColor, margin: 0 }}>
                  We&apos;ll record your request as pending. Capability Studio operators must
                  approve your consultant role; an organisation owner must then approve any
                  workspace link. You won&apos;t have org data access until both are complete.
                </p>
              ) : null}
              <button
                type="submit"
                style={{
                  padding: "10px 14px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#0a0c10",
                  background: "#c4f542",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Create account
              </button>
            </form>
          </>
        )}
        {authError && (
          <p style={{ color: "#e87878", marginTop: 12, fontSize: 14 }}>{authError}</p>
        )}
        {authInfo && (
          <p style={{ color: "#8fd9a8", marginTop: 12, fontSize: 14 }}>{authInfo}</p>
        )}
      </div>
    </AuthRecoveryChrome>
  );
}

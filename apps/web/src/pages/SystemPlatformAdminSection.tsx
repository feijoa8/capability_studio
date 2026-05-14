import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { sendPasswordResetOtp } from "../lib/passwordResetClient";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnPrimary,
  errorColor,
  fieldBg,
  mutedColor,
  panelShell,
  text,
} from "./hub/hubTheme";

type Props = { isActive: boolean };

type Tab = "overview" | "users" | "organisations" | "auth_diagnostics" | "email";

type OverviewCounts = {
  totalOrganisations: number;
  totalUsers: number;
  activeUsers30d: number;
  candidateUsers: number;
  passwordUsers: number;
  pendingInvites: number;
  recentPasswordResetRequests24h: number;
  recentLoginOtpSends24h: number;
  recent2faOtpSends24h: number;
  recentAuthErrors24h: number | null;
};

type PlatformUserRow = {
  user_id: string;
  email: string;
  profile_name: string | null;
  account_mode: string | null;
  primary_account_type: string | null;
  has_password: boolean;
  two_fa_enabled: boolean;
  org_memberships: unknown;
  candidate_applications_count: number;
  last_sign_in_at: string | null;
  password_reset_eligible: boolean;
  login_type: string;
};

type OrgRow = {
  organisation_id: string;
  name: string | null;
  created_at: string | null;
  member_count: number;
  active_members: number;
  pending_invites: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseOverviewCounts(v: unknown): OverviewCounts | null {
  if (!isRecord(v)) return null;
  return {
    totalOrganisations: num(v.totalOrganisations),
    totalUsers: num(v.totalUsers),
    activeUsers30d: num(v.activeUsers30d),
    candidateUsers: num(v.candidateUsers),
    passwordUsers: num(v.passwordUsers),
    pendingInvites: num(v.pendingInvites),
    recentPasswordResetRequests24h: num(v.recentPasswordResetRequests24h),
    recentLoginOtpSends24h: num(v.recentLoginOtpSends24h),
    recent2faOtpSends24h: num(v.recent2faOtpSends24h),
    recentAuthErrors24h:
      v.recentAuthErrors24h == null ? null : num(v.recentAuthErrors24h),
  };
}

function errorToText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (isRecord(e)) {
    const msg = typeof e.message === "string" ? e.message : null;
    const code = typeof e.code === "string" ? e.code : null;
    const details = typeof e.details === "string" ? e.details : null;
    const hint = typeof e.hint === "string" ? e.hint : null;
    const parts = [msg, code ? `code=${code}` : null, details, hint].filter(
      (p): p is string => Boolean(p && p.trim()),
    );
    if (parts.length) return parts.join(" · ");
    try {
      return JSON.stringify(e);
    } catch {
      // ignore
    }
  }
  return String(e);
}

export function SystemPlatformAdminSection({ isActive }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewCounts | null>(null);

  const [userQuery, setUserQuery] = useState("");
  const [userRows, setUserRows] = useState<PlatformUserRow[]>([]);
  const [userActionBusyId, setUserActionBusyId] = useState<string | null>(null);
  const [userNotice, setUserNotice] = useState<string | null>(null);

  const [orgRows, setOrgRows] = useState<OrgRow[]>([]);

  const [diagEmail, setDiagEmail] = useState("");
  const [diagJson, setDiagJson] = useState<Record<string, unknown> | null>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Platform overview" },
    { id: "users", label: "Users" },
    { id: "organisations", label: "Organisations" },
    { id: "auth_diagnostics", label: "Auth diagnostics" },
    { id: "email", label: "Email diagnostics" },
  ];

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    color: text,
    backgroundColor: fieldBg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    boxSizing: "border-box",
  };

  const card: CSSProperties = {
    padding: 14,
    borderRadius: 10,
    border: `1px solid ${borderSubtle}`,
    backgroundColor: bg,
  };

  useEffect(() => {
    if (!isActive || tab !== "overview") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase.rpc("platform_admin_overview_counts");
        if (error) throw error;
        const parsed = parseOverviewCounts(data);
        if (!parsed) throw new Error("Invalid overview payload.");
        if (!cancelled) setOverview(parsed);
      } catch (e) {
        if (!cancelled) setError(errorToText(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, tab]);

  useEffect(() => {
    if (!isActive || tab !== "organisations") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase.rpc("platform_admin_org_list", {
          p_limit: 60,
          p_offset: 0,
        });
        if (error) throw error;
        const rows = (Array.isArray(data) ? data : []) as OrgRow[];
        if (!cancelled) setOrgRows(rows);
      } catch (e) {
        if (!cancelled) setError(errorToText(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, tab]);

  async function runUserSearch(e?: FormEvent) {
    e?.preventDefault();
    setUserNotice(null);
    const q = userQuery.trim();
    if (q.length < 3) {
      setUserRows([]);
      setError("Enter at least 3 characters to search by email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("platform_admin_user_search", {
        p_query: q,
        p_limit: 25,
      });
      if (error) throw error;
      setUserRows((Array.isArray(data) ? data : []) as PlatformUserRow[]);
    } catch (e) {
      setError(errorToText(e));
    } finally {
      setLoading(false);
    }
  }

  async function runAuthDiagnostics(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    setDiagJson(null);
    try {
      const em = diagEmail.trim();
      if (!em) return;
      const { data, error } = await supabase.rpc("platform_admin_auth_diagnostics", {
        p_email: em,
      });
      if (error) throw error;
      setDiagJson(isRecord(data) ? data : null);
    } catch (e) {
      setError(errorToText(e));
    } finally {
      setLoading(false);
    }
  }

  const statsCards = useMemo(() => {
    if (!overview) return [];
    return [
      ["Total organisations", overview.totalOrganisations],
      ["Total users", overview.totalUsers],
      ["Active users (30d)", overview.activeUsers30d],
      ["Candidate / OTP users", overview.candidateUsers],
      ["Password users", overview.passwordUsers],
      ["Pending invites", overview.pendingInvites],
      ["Reset requests (24h)", overview.recentPasswordResetRequests24h],
      ["Login OTP sends (24h)", overview.recentLoginOtpSends24h],
      ["2FA OTP sends (24h)", overview.recent2faOtpSends24h],
    ] as const;
  }, [overview]);

  return (
    <div style={{ ...panelShell, maxWidth: 1100 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, color: text }}>
        System · Platform Admin
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
        System-level support and diagnostics. Read-mostly. Actions are guarded and never expose
        secrets, hashes, tokens, or OTP values.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setError(null);
            }}
            style={{
              ...btn,
              fontWeight: tab === t.id ? 600 : 400,
              border: `1px solid ${tab === t.id ? text : border}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <p style={{ color: errorColor, marginBottom: 12 }}>{error}</p> : null}
      {loading ? <p style={{ color: mutedColor, marginBottom: 12 }}>Loading…</p> : null}

      {tab === "overview" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          {statsCards.map(([label, n]) => (
            <div key={label} style={card}>
              <div style={{ fontSize: 12, color: mutedColor }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: text }}>{n}</div>
            </div>
          ))}
          <div style={card}>
            <div style={{ fontSize: 12, color: mutedColor }}>Auth errors (24h)</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: text }}>
              {overview?.recentAuthErrors24h ?? "—"}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: mutedColor }}>
              Not tracked yet (TODO: email_events/auth_events table).
            </div>
          </div>
        </div>
      ) : null}

      {tab === "users" ? (
        <div style={{ display: "grid", gap: 12 }}>
          <form onSubmit={(e) => void runUserSearch(e)} style={{ display: "flex", gap: 10 }}>
            <input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Search email (exact or partial)"
              style={inputStyle}
            />
            <button type="submit" style={btnPrimary} disabled={loading}>
              Search
            </button>
          </form>
          {userNotice ? (
            <p style={{ margin: 0, fontSize: 13, color: "#8fd9a8" }}>{userNotice}</p>
          ) : null}
          {userRows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
              Enter an email to search.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {[
                      "Email",
                      "Auth user id",
                      "Profile",
                      "account_mode",
                      "primary_account_type",
                      "Login type",
                      "2FA",
                      "Last sign-in",
                      "Reset eligible",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          fontSize: 12,
                          color: mutedColor,
                          padding: "8px 10px",
                          borderBottom: `1px solid ${borderSubtle}`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {userRows.map((u) => (
                    <tr key={u.user_id}>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}` }}>
                        <div style={{ color: text, fontSize: 13 }}>{u.email}</div>
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}` }}>
                        <code style={{ color: mutedColor, fontSize: 11 }}>{u.user_id}</code>
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text, fontSize: 13 }}>
                        {u.profile_name ?? "—"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text, fontSize: 13 }}>
                        {u.account_mode ?? "—"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text, fontSize: 13 }}>
                        {u.primary_account_type ?? "—"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text, fontSize: 13 }}>
                        {u.login_type}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text, fontSize: 13 }}>
                        {u.two_fa_enabled ? "enabled" : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text, fontSize: 13 }}>
                        {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text, fontSize: 13 }}>
                        {u.password_reset_eligible ? "yes" : "no"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}` }}>
                        <button
                          type="button"
                          style={{
                            ...btn,
                            fontSize: 12,
                            padding: "7px 10px",
                            opacity:
                              userActionBusyId === u.user_id
                                ? 0.7
                                : u.password_reset_eligible
                                  ? 1
                                  : 0.5,
                            cursor:
                              userActionBusyId === u.user_id
                                ? "wait"
                                : u.password_reset_eligible
                                  ? "pointer"
                                  : "not-allowed",
                          }}
                          disabled={
                            userActionBusyId === u.user_id || !u.password_reset_eligible
                          }
                          title={
                            u.password_reset_eligible
                              ? "Send password reset email (no password setting)"
                              : "OTP-only user — password reset not applicable"
                          }
                          onClick={async () => {
                            setUserNotice(null);
                            setUserActionBusyId(u.user_id);
                            try {
                              const out = await sendPasswordResetOtp(supabase, u.email);
                              if (out.error) throw new Error(out.error);
                              setUserNotice("Password reset email sent (if eligible).");
                            } catch (e) {
                              setError(errorToText(e));
                            } finally {
                              setUserActionBusyId(null);
                            }
                          }}
                        >
                          Send password reset email
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "organisations" ? (
        <div style={{ display: "grid", gap: 12 }}>
          {orgRows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
              No organisations found.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Name", "Org id", "Created", "Members", "Active", "Invites"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          fontSize: 12,
                          color: mutedColor,
                          padding: "8px 10px",
                          borderBottom: `1px solid ${borderSubtle}`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orgRows.map((o) => (
                    <tr key={o.organisation_id}>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text }}>
                        {o.name ?? "—"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}` }}>
                        <code style={{ color: mutedColor, fontSize: 11 }}>{o.organisation_id}</code>
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text }}>
                        {o.created_at ? new Date(o.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text }}>
                        {o.member_count}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text }}>
                        {o.active_members}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: `1px solid ${borderSubtle}`, color: text }}>
                        {o.pending_invites}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "auth_diagnostics" ? (
        <div style={{ display: "grid", gap: 12 }}>
          <form onSubmit={(e) => void runAuthDiagnostics(e)} style={{ display: "flex", gap: 10 }}>
            <input
              value={diagEmail}
              onChange={(e) => setDiagEmail(e.target.value)}
              placeholder="Lookup by email"
              style={inputStyle}
            />
            <button type="submit" style={btnPrimary} disabled={loading}>
              Lookup
            </button>
          </form>
          {diagJson ? (
            <pre
              style={{
                margin: 0,
                padding: 14,
                borderRadius: 10,
                border: `1px solid ${borderSubtle}`,
                backgroundColor: bg,
                color: text,
                fontSize: 12,
                overflowX: "auto",
              }}
            >
              {JSON.stringify(diagJson, null, 2)}
            </pre>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
              Shows safe metadata only (no OTPs, hashes, tokens, passwords, or secrets).
            </p>
          )}
        </div>
      ) : null}

      {tab === "email" ? (
        <div style={card}>
          <p style={{ margin: 0, color: mutedColor, fontSize: 13, lineHeight: 1.5 }}>
            Email diagnostics is DB-only for now. TODO: add an <code>email_events</code> table for
            Resend send attempt tracking.
          </p>
        </div>
      ) : null}
    </div>
  );
}


import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  completeOrganisationAccountIntent,
  completePersonalAccountSetup,
} from "../../lib/accountSetupCompletion";
import { supabase } from "../../lib/supabase";
import { membershipGrantsOrgData } from "../../lib/membershipEffective";
import type { WorkspaceMembership } from "../hub/types";
import { AuthRecoveryChrome } from "./PasswordRecoveryViews";
import {
  bg,
  border,
  brandLime,
  errorColor,
  mutedColor,
  panelShell,
  surface,
  text,
} from "../hub/hubTheme";

const SESSION_KEY = "cs_account_setup_complete";

export function isAccountSetupCompleteInSession(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

export function markAccountSetupComplete(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, "1");
}

type AccountPath = "personal" | "workspace";

type WorkspaceLine = { orgName: string; status: string };

function humanizeMembershipStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s === "invited") return "Invited";
  if (s === "pending") return "Pending";
  if (s === "active") return "Member";
  if (!s) return "Pending";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function organisationName(m: WorkspaceMembership): string {
  const o = m.organisations as
    | { id?: string; name?: string | null }
    | { id?: string; name?: string | null }[]
    | null;
  if (!o) return "Workspace";
  if (Array.isArray(o)) return o[0]?.name?.trim() || "Workspace";
  return o.name?.trim() || "Workspace";
}

function deriveLinesForOrg(
  rows: WorkspaceMembership[],
  profileSystemRole: string | null,
): WorkspaceLine {
  const orgName = organisationName(rows[0]!);
  for (const m of rows) {
    if (
      m.membership_status === "active" &&
      membershipGrantsOrgData(m, profileSystemRole)
    ) {
      return { orgName, status: "Member" };
    }
  }
  for (const m of rows) {
    if (m.membership_status && m.membership_status !== "active") {
      return { orgName, status: humanizeMembershipStatus(m.membership_status) };
    }
  }
  for (const m of rows) {
    if (m.access_type === "consultant" && m.approved_by_owner !== true) {
      return { orgName, status: "Pending" };
    }
  }
  return { orgName, status: "Pending" };
}

function buildWorkspaceLines(
  raw: WorkspaceMembership[],
  profileSystemRole: string | null,
): WorkspaceLine[] {
  const byOrg = new Map<string, WorkspaceMembership[]>();
  for (const r of raw) {
    const list = byOrg.get(r.organisation_id) ?? [];
    list.push(r);
    byOrg.set(r.organisation_id, list);
  }
  const lines: WorkspaceLine[] = [];
  for (const [, rows] of byOrg) {
    lines.push(deriveLinesForOrg(rows, profileSystemRole));
  }
  lines.sort((a, b) => a.orgName.localeCompare(b.orgName));
  return lines;
}

type Props = {
  userEmail: string;
  onComplete: () => void;
};

export function AccountSetupScreen({ userEmail: _userEmail, onComplete }: Props) {
  void _userEmail;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceLines, setWorkspaceLines] = useState<WorkspaceLine[]>([]);
  const [consultantPending, setConsultantPending] = useState(false);
  const [pathChoice, setPathChoice] = useState<AccountPath>("personal");
  const [continuing, setContinuing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setLoadError("Not signed in.");
      setLoading(false);
      return;
    }

    const [memRes, profRes, crRes] = await Promise.all([
      supabase.from("workspace_memberships").select(`
          id,
          organisation_id,
          workspace_role,
          system_role,
          access_type,
          approved_by_owner,
          is_primary,
          membership_status,
          organisations ( id, name )
        `),
      supabase.from("profiles").select("system_role").eq("id", uid).maybeSingle(),
      supabase
        .from("consultant_requests")
        .select("id, status")
        .eq("user_id", uid)
        .maybeSingle(),
    ]);

    const profileSystemRole = (profRes.data?.system_role as string | null) ?? null;

    if (memRes.error) {
      setLoadError(memRes.error.message);
      setWorkspaceLines([]);
    } else {
      const raw =
        (memRes.data as unknown as WorkspaceMembership[] | null) ?? [];
      setWorkspaceLines(buildWorkspaceLines(raw, profileSystemRole));
    }

    const cr = crRes.data as { status?: string } | null;
    setConsultantPending(cr?.status === "pending");

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasWorkspaceContext =
    workspaceLines.length > 0 || consultantPending;

  const showWorkspaceList = workspaceLines.length > 0;

  const title = hasWorkspaceContext
    ? "Complete your account"
    : "Create your account";

  const subtext = hasWorkspaceContext
    ? "Choose how you want to use Capability Studio. You can connect to a workspace now or skip and join later."
    : "Choose how you want to get started.";

  const continueLabel =
    pathChoice === "workspace"
      ? "Continue to workspace"
      : "Continue";

  async function handleContinue() {
    setActionError(null);
    setContinuing(true);
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      setActionError(authErr?.message ?? "Not signed in.");
      setContinuing(false);
      return;
    }
    if (pathChoice === "personal") {
      const r = await completePersonalAccountSetup(supabase, user);
      if (!r.ok) {
        setActionError(r.error ?? "Could not save your Personal Account.");
        setContinuing(false);
        return;
      }
    } else {
      const r = await completeOrganisationAccountIntent(supabase, user);
      if (!r.ok) {
        setActionError(
          r.error ?? "Could not save your workspace account preferences.",
        );
        setContinuing(false);
        return;
      }
    }
    markAccountSetupComplete();
    onComplete();
    setContinuing(false);
  }

  const optionBase: CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    padding: "14px 16px",
    borderRadius: 10,
    border: `1px solid ${border}`,
    backgroundColor: bg,
    color: text,
    cursor: "pointer",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <AuthRecoveryChrome>
      <div style={{ ...panelShell, padding: "22px 20px" }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            margin: "0 0 8px",
            color: text,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: "0 0 22px",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.55,
          }}
        >
          {subtext}
        </p>

        {loading ? (
          <p style={{ color: mutedColor, fontSize: 14 }}>Loading your account…</p>
        ) : loadError ? (
          <p style={{ color: errorColor, fontSize: 14 }}>{loadError}</p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Account type"
              style={{ display: "grid", gap: 12, marginBottom: 20 }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={pathChoice === "personal"}
                onClick={() => setPathChoice("personal")}
                style={{
                  ...optionBase,
                  outline:
                    pathChoice === "personal"
                      ? `2px solid ${brandLime}`
                      : undefined,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, display: "block" }}>
                  Create Personal Account
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: mutedColor,
                    marginTop: 6,
                    display: "block",
                    lineHeight: 1.45,
                  }}
                >
                  Your own Personal Account — capability features without an organisation
                  workspace.
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={pathChoice === "workspace"}
                onClick={() => setPathChoice("workspace")}
                style={{
                  ...optionBase,
                  outline:
                    pathChoice === "workspace"
                      ? `2px solid ${brandLime}`
                      : undefined,
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, display: "block" }}>
                  Complete Account for Workspace Access
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: mutedColor,
                    marginTop: 6,
                    display: "block",
                    lineHeight: 1.45,
                  }}
                >
                  Connect to an organisation or team
                </span>
              </button>
            </div>

            {showWorkspaceList ? (
              <div style={{ marginBottom: 18 }}>
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Available workspaces
                </p>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  {workspaceLines.map((line, i) => (
                    <li
                      key={`${line.orgName}-${i}`}
                      style={{
                        padding: "12px 14px",
                        borderBottom:
                          i < workspaceLines.length - 1
                            ? `1px solid ${border}`
                            : undefined,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "baseline",
                        backgroundColor: surface,
                      }}
                    >
                      <span style={{ fontSize: 14, color: text }}>{line.orgName}</span>
                      <span
                        style={{
                          fontSize: 13,
                          color: mutedColor,
                          flexShrink: 0,
                        }}
                      >
                        {line.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p
              style={{
                margin: "0 0 20px",
                fontSize: 13,
                color: mutedColor,
                lineHeight: 1.55,
              }}
            >
              Not seeing your organisation yet? You can still complete your account
              now and connect to a workspace later.
            </p>

            {actionError ? (
              <p
                style={{
                  margin: "0 0 14px",
                  fontSize: 14,
                  color: errorColor,
                  lineHeight: 1.45,
                }}
              >
                {actionError}
              </p>
            ) : null}

            <button
              type="button"
              disabled={continuing}
              onClick={() => void handleContinue()}
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: 15,
                fontWeight: 600,
                color: "#0a0c10",
                background: brandLime,
                border: "none",
                borderRadius: 8,
                cursor: continuing ? "wait" : "pointer",
                opacity: continuing ? 0.85 : 1,
              }}
            >
              {continuing ? "Saving…" : continueLabel}
            </button>
          </>
        )}
      </div>
    </AuthRecoveryChrome>
  );
}

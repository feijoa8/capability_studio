import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../lib/supabase";
import type { TeamRow } from "./hub/types";
import {
  border,
  borderSubtle,
  errorColor,
  muted,
  mutedColor,
  panelShell,
  surface,
  text,
} from "./hub/hubTheme";
import { canAccessWorkspaceAdminSurfaces } from "./hub/workspaceRoles";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  workspaceRole: string | null;
};

type AdminMemberRow = {
  membershipId: string;
  user_id: string;
  workspace_role: string;
  membership_status: string;
  profile_email?: string | null;
  profile_display_name?: string | null;
  profile_first_name?: string | null;
  profile_last_name?: string | null;
  manager_user_id?: string | null;
  team_id?: string | null;
};

function displayName(m: AdminMemberRow): string {
  const dn = m.profile_display_name?.trim();
  if (dn) return dn;
  const fn = (m.profile_first_name ?? "").trim();
  const ln = (m.profile_last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  return m.profile_email?.trim() || `${m.user_id.slice(0, 8)}…`;
}

const WORKSPACE_ROLE_OPTIONS = [
  "member",
  "learning_lead",
  "company_admin",
  "admin",
] as const;

function roleOptionsFor(current: string): string[] {
  return Array.from(new Set<string>([...WORKSPACE_ROLE_OPTIONS, current]));
}

const selectStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 8,
  border: `1px solid ${borderSubtle}`,
  backgroundColor: "#0c0f14",
  color: text,
  minWidth: 200,
  maxWidth: 280,
};

export function UserAdminSection({
  activeOrgId,
  isActive,
  workspaceRole,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminMemberRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [managerSavingUserId, setManagerSavingUserId] = useState<string | null>(
    null
  );
  const [teamSavingUserId, setTeamSavingUserId] = useState<string | null>(null);
  const [managerNames, setManagerNames] = useState<Record<string, string>>({});
  const [teamsList, setTeamsList] = useState<TeamRow[]>([]);

  const canEditRoles = canAccessWorkspaceAdminSurfaces(workspaceRole);

  const load = useCallback(async () => {
    if (!activeOrgId || !isActive) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const memRes = await supabase
      .from("workspace_memberships")
      .select("id, user_id, workspace_role, membership_status")
      .eq("organisation_id", activeOrgId)
      .order("user_id", { ascending: true })
      .limit(2000);

    if (memRes.error) {
      console.error(memRes.error);
      setError(memRes.error.message);
      setRows([]);
      setTeamsList([]);
      setLoading(false);
      return;
    }

    const raw = (memRes.data ?? []) as {
      id: string;
      user_id: string;
      workspace_role: string;
      membership_status: string;
    }[];

    const seen = new Set<string>();
    const deduped = raw.filter((r) => {
      if (seen.has(r.user_id)) return false;
      seen.add(r.user_id);
      return true;
    });

    const userIds = deduped.map((r) => r.user_id);

    let next: AdminMemberRow[] = deduped.map((r) => ({
      membershipId: r.id,
      user_id: r.user_id,
      workspace_role: r.workspace_role,
      membership_status: r.membership_status,
    }));

    if (userIds.length > 0) {
      const profRes = await supabase
        .from("profiles")
        .select("id,email,display_name,first_name,last_name")
        .in("id", userIds);

      const [linesRes, teamsRes, assignRes] = await Promise.all([
        supabase
          .from("user_reporting_lines")
          .select("user_id, manager_user_id")
          .eq("organisation_id", activeOrgId)
          .in("user_id", userIds),
        supabase
          .from("teams")
          .select("*")
          .eq("organisation_id", activeOrgId)
          .order("name", { ascending: true }),
        supabase
          .from("user_team_assignments")
          .select("user_id, team_id")
          .eq("organisation_id", activeOrgId)
          .in("user_id", userIds),
      ]);
      if (linesRes.error) {
        console.warn("[user_admin] user_reporting_lines:", linesRes.error.message);
      }
      if (teamsRes.error) {
        console.warn("[user_admin] teams:", teamsRes.error.message);
      }
      if (assignRes.error) {
        console.warn(
          "[user_admin] user_team_assignments:",
          assignRes.error.message
        );
      }

      const teamsParsed: TeamRow[] = (teamsRes.data ?? []).map((raw) => {
        const r = raw as Record<string, unknown>;
        return {
          id: String(r.id),
          organisation_id: String(r.organisation_id),
          name: String(r.name ?? ""),
          description:
            r.description === null || r.description === undefined
              ? null
              : String(r.description),
          manager_user_id:
            r.manager_user_id == null ? null : String(r.manager_user_id),
          created_at: String(r.created_at ?? ""),
          updated_at: String(r.updated_at ?? ""),
        };
      });
      setTeamsList(teamsParsed);

      const teamByUser = new Map<string, string>();
      for (const row of (assignRes.error ? [] : assignRes.data) ?? []) {
        const a = row as { user_id: string; team_id: string };
        teamByUser.set(a.user_id, a.team_id);
      }

      const pmap = new Map(
        (profRes.data ?? []).map((p) => [
          (p as { id: string }).id,
          p as {
            email?: string | null;
            display_name?: string | null;
            first_name?: string | null;
            last_name?: string | null;
          },
        ])
      );

      const managerIds = new Set<string>();
      const lineByUser = new Map<string, string | null>();
      for (const line of (linesRes.error ? [] : linesRes.data) ?? []) {
        const l = line as { user_id: string; manager_user_id: string };
        lineByUser.set(l.user_id, l.manager_user_id);
        managerIds.add(l.manager_user_id);
      }

      next = next.map((row) => {
        const p = pmap.get(row.user_id);
        return {
          ...row,
          profile_email: p?.email ?? undefined,
          profile_display_name: p?.display_name ?? undefined,
          profile_first_name: p?.first_name ?? undefined,
          profile_last_name: p?.last_name ?? undefined,
          manager_user_id: lineByUser.get(row.user_id) ?? null,
          team_id: teamByUser.get(row.user_id) ?? null,
        };
      });

      if (managerIds.size > 0) {
        const mgrProf = await supabase
          .from("profiles")
          .select("id,display_name,first_name,last_name,email")
          .in("id", [...managerIds]);
        const nameById: Record<string, string> = {};
        for (const p of mgrProf.data ?? []) {
          const r = p as {
            id: string;
            display_name?: string | null;
            first_name?: string | null;
            last_name?: string | null;
            email?: string | null;
          };
          const dn = r.display_name?.trim();
          const fn = (r.first_name ?? "").trim();
          const ln = (r.last_name ?? "").trim();
          const combined = [fn, ln].filter(Boolean).join(" ");
          nameById[r.id] =
            dn || combined || r.email?.trim() || `${r.id.slice(0, 8)}…`;
        }
        setManagerNames(nameById);
      } else {
        setManagerNames({});
      }
    } else {
      setManagerNames({});
      setTeamsList([]);
    }

    setRows(next);
    setLoading(false);
  }, [activeOrgId, isActive]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTeamChange(memberRow: AdminMemberRow, rawValue: string) {
    if (!canEditRoles || !activeOrgId) return;
    const nextTeamId = rawValue.trim() || null;
    const prev = memberRow.team_id ?? null;
    if (nextTeamId === prev) return;
    if (!nextTeamId && !prev) return;

    setTeamSavingUserId(memberRow.user_id);
    try {
      if (!nextTeamId) {
        const { error: delErr } = await supabase
          .from("user_team_assignments")
          .delete()
          .eq("organisation_id", activeOrgId)
          .eq("user_id", memberRow.user_id);
        if (delErr) throw delErr;
      } else {
        const { error: upErr } = await supabase
          .from("user_team_assignments")
          .upsert(
            {
              organisation_id: activeOrgId,
              user_id: memberRow.user_id,
              team_id: nextTeamId,
            },
            { onConflict: "organisation_id,user_id" }
          );
        if (upErr) throw upErr;
      }
      await load();
    } catch (e) {
      console.error(e);
      alert(
        e instanceof Error
          ? e.message
          : "Could not update team assignment."
      );
    } finally {
      setTeamSavingUserId(null);
    }
  }

  async function handleManagerChange(memberRow: AdminMemberRow, rawValue: string) {
    if (!canEditRoles || !activeOrgId) return;
    const nextManagerId = rawValue.trim() || null;
    const prev = memberRow.manager_user_id ?? null;
    if (nextManagerId === prev) return;
    if (!nextManagerId && !prev) return;

    setManagerSavingUserId(memberRow.user_id);
    try {
      if (!nextManagerId) {
        const { error: delErr } = await supabase
          .from("user_reporting_lines")
          .delete()
          .eq("organisation_id", activeOrgId)
          .eq("user_id", memberRow.user_id);
        if (delErr) throw delErr;
      } else {
        const { error: upErr } = await supabase.from("user_reporting_lines").upsert(
          {
            organisation_id: activeOrgId,
            user_id: memberRow.user_id,
            manager_user_id: nextManagerId,
          },
          { onConflict: "organisation_id,user_id" }
        );
        if (upErr) throw upErr;
      }
      await load();
    } catch (e) {
      console.error(e);
      alert(
        e instanceof Error
          ? e.message
          : "Could not update manager assignment."
      );
    } finally {
      setManagerSavingUserId(null);
    }
  }

  async function handleRoleChange(membershipId: string, nextRole: string) {
    if (!canEditRoles || !activeOrgId) return;
    setSavingId(membershipId);
    const { error: uErr } = await supabase
      .from("workspace_memberships")
      .update({ workspace_role: nextRole })
      .eq("id", membershipId)
      .eq("organisation_id", activeOrgId);
    setSavingId(null);
    if (uErr) {
      console.error(uErr);
      alert(uErr.message || "Could not update workspace role.");
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.membershipId === membershipId
          ? { ...r, workspace_role: nextRole }
          : r
      )
    );
  }

  if (!isActive) return null;

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
          Select a workspace to manage members.
        </p>
      </div>
    );
  }

  const tableWrap: CSSProperties = {
    overflowX: "auto",
    borderRadius: 10,
    border: `1px solid ${border}`,
    backgroundColor: surface,
  };

  const th: CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: mutedColor,
    borderBottom: `1px solid ${borderSubtle}`,
    whiteSpace: "nowrap",
  };

  const td: CSSProperties = {
    padding: "12px 12px",
    fontSize: 13,
    color: text,
    borderBottom: `1px solid ${borderSubtle}`,
    verticalAlign: "top",
  };

  return (
    <div
      style={{
        maxWidth: 1100,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.55 }}>
        Workspace membership, roles, and org structure.{" "}
        <strong style={{ color: text }}>Primary team</strong> membership is
        managed on the <strong style={{ color: text }}>Teams</strong> page; the
        team column below is optional for quick edits. Capability review stays
        under <strong style={{ color: text }}>Member Capability</strong>.
      </p>

      {loading ? (
        <p style={{ ...muted, margin: 0 }}>Loading members…</p>
      ) : error ? (
        <p style={{ margin: 0, color: errorColor }}>{error}</p>
      ) : rows.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>No members in this workspace.</p>
      ) : (
        <div style={tableWrap}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 720,
            }}
          >
            <thead>
              <tr>
                <th style={th}>Member</th>
                <th style={th}>Workspace role</th>
                <th style={th}>Manager</th>
                <th
                  style={{
                    ...th,
                    whiteSpace: "normal",
                    maxWidth: 200,
                  }}
                >
                  Team
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 9,
                      fontWeight: 500,
                      letterSpacing: "0.04em",
                      textTransform: "none",
                      color: mutedColor,
                      lineHeight: 1.35,
                    }}
                  >
                    Secondary — use Teams
                  </div>
                </th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.membershipId}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{displayName(m)}</div>
                    {m.profile_email?.trim() ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: mutedColor,
                          marginTop: 4,
                        }}
                      >
                        {m.profile_email.trim()}
                      </div>
                    ) : null}
                  </td>
                  <td style={td}>
                    {canEditRoles ? (
                      <select
                        value={m.workspace_role}
                        disabled={
                          savingId === m.membershipId ||
                          managerSavingUserId === m.user_id ||
                          teamSavingUserId === m.user_id
                        }
                        onChange={(e) =>
                          void handleRoleChange(m.membershipId, e.target.value)
                        }
                        style={{
                          ...selectStyle,
                          maxWidth: 200,
                          opacity:
                            managerSavingUserId === m.user_id ||
                            teamSavingUserId === m.user_id
                              ? 0.65
                              : 1,
                        }}
                      >
                        {roleOptionsFor(m.workspace_role).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{m.workspace_role}</span>
                    )}
                  </td>
                  <td style={td}>
                    {canEditRoles ? (
                      <select
                        value={m.manager_user_id ?? ""}
                        disabled={
                          managerSavingUserId === m.user_id ||
                          teamSavingUserId === m.user_id
                        }
                        onChange={(e) =>
                          void handleManagerChange(m, e.target.value)
                        }
                        style={{
                          ...selectStyle,
                          opacity:
                            managerSavingUserId === m.user_id ||
                            teamSavingUserId === m.user_id
                              ? 0.65
                              : 1,
                        }}
                      >
                        <option value="">No manager</option>
                        {rows
                          .filter((r) => r.user_id !== m.user_id)
                          .slice()
                          .sort((a, b) =>
                            displayName(a).localeCompare(
                              displayName(b),
                              undefined,
                              { sensitivity: "base" }
                            )
                          )
                          .map((r) => (
                            <option key={r.user_id} value={r.user_id}>
                              {displayName(r)}
                            </option>
                          ))}
                        {m.manager_user_id &&
                        !rows.some((r) => r.user_id === m.manager_user_id) ? (
                          <option value={m.manager_user_id}>
                            {managerNames[m.manager_user_id] ??
                              `${m.manager_user_id.slice(0, 8)}…`}{" "}
                            (not in workspace)
                          </option>
                        ) : null}
                      </select>
                    ) : m.manager_user_id ? (
                      <span>
                        {managerNames[m.manager_user_id] ??
                          `${m.manager_user_id.slice(0, 8)}…`}
                      </span>
                    ) : (
                      <span style={{ color: mutedColor }}>No manager</span>
                    )}
                  </td>
                  <td style={td}>
                    {canEditRoles ? (
                      <select
                        value={m.team_id ?? ""}
                        disabled={
                          teamSavingUserId === m.user_id ||
                          managerSavingUserId === m.user_id
                        }
                        onChange={(e) =>
                          void handleTeamChange(m, e.target.value)
                        }
                        style={{
                          ...selectStyle,
                          opacity:
                            teamSavingUserId === m.user_id ||
                            managerSavingUserId === m.user_id
                              ? 0.65
                              : 1,
                        }}
                      >
                        <option value="">No team</option>
                        {teamsList.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                        {m.team_id &&
                        !teamsList.some((t) => t.id === m.team_id) ? (
                          <option value={m.team_id}>
                            Unknown team ({m.team_id.slice(0, 8)}…)
                          </option>
                        ) : null}
                      </select>
                    ) : m.team_id ? (
                      <span>
                        {teamsList.find((t) => t.id === m.team_id)?.name ??
                          `${m.team_id.slice(0, 8)}…`}
                      </span>
                    ) : (
                      <span style={{ color: mutedColor }}>No team</span>
                    )}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 8px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        border: `1px solid ${borderSubtle}`,
                        color:
                          m.membership_status === "active"
                            ? "#8fd4a8"
                            : mutedColor,
                      }}
                    >
                      {m.membership_status}
                    </span>
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 11,
                        color: mutedColor,
                        lineHeight: 1.4,
                      }}
                    >
                      Activate/deactivate — coming soon
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

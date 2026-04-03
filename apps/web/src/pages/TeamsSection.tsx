import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type { TeamRow } from "./hub/types";
import {
  border,
  borderSubtle,
  btn,
  btnGhost,
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

type MemberOption = {
  user_id: string;
  label: string;
};

/** Member row for display under a team card */
type TeamMemberDisplay = {
  userId: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  levelName: string | null;
};

function displayNameFromProfile(p: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  id: string;
}): string {
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  return p.email?.trim() || `${p.id.slice(0, 8)}…`;
}

function parseTeam(raw: unknown): TeamRow {
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
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 8,
  border: `1px solid ${borderSubtle}`,
  backgroundColor: "#0c0f14",
  color: text,
  boxSizing: "border-box",
};

export function TeamsSection({
  activeOrgId,
  isActive,
  workspaceRole,
}: Props) {
  const canEdit = canAccessWorkspaceAdminSurfaces(workspaceRole);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);

  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createManagerId, setCreateManagerId] = useState("");
  const [createSaving, setCreateSaving] = useState(false);

  const [rowDraft, setRowDraft] = useState<
    Record<
      string,
      { name: string; description: string; manager_user_id: string }
    >
  >({});
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [teamMembersByTeamId, setTeamMembersByTeamId] = useState<
    Record<string, TeamMemberDisplay[]>
  >({});

  const [addMemberForTeamId, setAddMemberForTeamId] = useState<string | null>(
    null
  );
  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [addMemberSaving, setAddMemberSaving] = useState(false);
  const [memberActionKey, setMemberActionKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrgId || !isActive) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [teamsRes, memRes, assignRes] = await Promise.all([
      supabase
        .from("teams")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .order("name", { ascending: true }),
      supabase
        .from("workspace_memberships")
        .select("user_id")
        .eq("organisation_id", activeOrgId)
        .eq("membership_status", "active")
        .order("user_id", { ascending: true }),
      supabase
        .from("user_team_assignments")
        .select("user_id, team_id")
        .eq("organisation_id", activeOrgId),
    ]);

    if (teamsRes.error) {
      console.error(teamsRes.error);
      setError(teamsRes.error.message);
      setTeams([]);
      setTeamMembersByTeamId({});
      setLoading(false);
      return;
    }

    const parsed = (teamsRes.data ?? []).map(parseTeam);
    setTeams(parsed);

    const teamIdSet = new Set(parsed.map((t) => t.id));
    const byTeam = new Map<string, string[]>();
    if (assignRes.error) {
      console.warn("[teams] user_team_assignments:", assignRes.error.message);
    } else {
      for (const row of assignRes.data ?? []) {
        const r = row as { user_id: string; team_id: string };
        if (!teamIdSet.has(r.team_id)) continue;
        if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
        byTeam.get(r.team_id)!.push(r.user_id);
      }
    }

    const allAssignedUserIds = [
      ...new Set(
        [...byTeam.values()].flatMap((ids) => ids)
      ),
    ];

    const emptyByTeam: Record<string, TeamMemberDisplay[]> = {};
    for (const t of parsed) {
      emptyByTeam[t.id] = [];
    }

    if (allAssignedUserIds.length === 0) {
      setTeamMembersByTeamId(emptyByTeam);
    } else {
      const [profRes, ujpRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,email,display_name,first_name,last_name")
          .in("id", allAssignedUserIds),
        supabase
          .from("user_job_profiles")
          .select("user_id, job_profile_id")
          .eq("organisation_id", activeOrgId)
          .in("user_id", allAssignedUserIds),
      ]);

      const profileById = new Map<
        string,
        {
          id: string;
          email?: string | null;
          display_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
        }
      >();
      for (const p of profRes.data ?? []) {
        const row = p as {
          id: string;
          email?: string | null;
          display_name?: string | null;
          first_name?: string | null;
          last_name?: string | null;
        };
        profileById.set(row.id, row);
      }

      const jobIdByUser = new Map<string, string | null>();
      if (!ujpRes.error && ujpRes.data) {
        for (const row of ujpRes.data as {
          user_id: string;
          job_profile_id: string | null;
        }[]) {
          jobIdByUser.set(row.user_id, row.job_profile_id);
        }
      }

      const jobIds = [
        ...new Set(
          [...jobIdByUser.values()].filter(
            (id): id is string => id != null && id !== ""
          )
        ),
      ];

      const titleLevelByJobId = new Map<
        string,
        { title: string; level: string | null }
      >();
      if (jobIds.length > 0) {
        const jpRes = await supabase
          .from("job_profiles")
          .select("id, title, level_name")
          .eq("organisation_id", activeOrgId)
          .in("id", jobIds);
        if (!jpRes.error && jpRes.data) {
          for (const j of jpRes.data as {
            id: string;
            title: string;
            level_name: string | null;
          }[]) {
            titleLevelByJobId.set(j.id, {
              title: j.title ?? "",
              level: j.level_name?.trim() || null,
            });
          }
        }
      }

      const built: Record<string, TeamMemberDisplay[]> = { ...emptyByTeam };
      for (const t of parsed) {
        const uids = byTeam.get(t.id) ?? [];
        const rows: TeamMemberDisplay[] = uids.map((uid) => {
          const prof = profileById.get(uid);
          const jid = jobIdByUser.get(uid) ?? null;
          const jl = jid ? titleLevelByJobId.get(jid) : undefined;
          const title = jl?.title?.trim() || null;
          return {
            userId: uid,
            displayName: prof
              ? displayNameFromProfile(prof)
              : `${uid.slice(0, 8)}…`,
            email: prof?.email?.trim() || null,
            jobTitle: title,
            levelName: title ? jl?.level ?? null : null,
          };
        });
        rows.sort((a, b) =>
          a.displayName.localeCompare(b.displayName, undefined, {
            sensitivity: "base",
          })
        );
        built[t.id] = rows;
      }
      setTeamMembersByTeamId(built);
    }

    const draft: Record<
      string,
      { name: string; description: string; manager_user_id: string }
    > = {};
    for (const t of parsed) {
      draft[t.id] = {
        name: t.name,
        description: t.description ?? "",
        manager_user_id: t.manager_user_id ?? "",
      };
    }
    setRowDraft(draft);

    const seenUid = new Set<string>();
    const userIds: string[] = [];
    for (const r of memRes.data ?? []) {
      const u = String((r as { user_id: string }).user_id);
      if (seenUid.has(u)) continue;
      seenUid.add(u);
      userIds.push(u);
    }

    if (userIds.length > 0 && !memRes.error) {
      const profRes = await supabase
        .from("profiles")
        .select("id,email,display_name,first_name,last_name")
        .in("id", userIds);
      const pmap = new Map(
        (profRes.data ?? []).map((p) => {
          const row = p as {
            id: string;
            email?: string | null;
            display_name?: string | null;
            first_name?: string | null;
            last_name?: string | null;
          };
          const dn = row.display_name?.trim();
          const fn = (row.first_name ?? "").trim();
          const ln = (row.last_name ?? "").trim();
          const combined = [fn, ln].filter(Boolean).join(" ");
          const label =
            dn || combined || row.email?.trim() || `${row.id.slice(0, 8)}…`;
          return [row.id, label] as const;
        })
      );
      setMemberOptions(
        userIds.map((uid) => ({
          user_id: uid,
          label: pmap.get(uid) ?? `${uid.slice(0, 8)}…`,
        }))
      );
    } else {
      setMemberOptions([]);
    }

    setLoading(false);
  }, [activeOrgId, isActive]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!canEdit || !activeOrgId) return;
    const name = createName.trim();
    if (!name) {
      alert("Enter a team name.");
      return;
    }
    setCreateSaving(true);
    const { error: insErr } = await supabase.from("teams").insert({
      organisation_id: activeOrgId,
      name,
      description: createDesc.trim() || null,
      manager_user_id: createManagerId || null,
    });
    setCreateSaving(false);
    if (insErr) {
      console.error(insErr);
      alert(insErr.message || "Could not create team.");
      return;
    }
    setCreateName("");
    setCreateDesc("");
    setCreateManagerId("");
    await load();
  }

  async function saveTeam(teamId: string) {
    if (!canEdit || !activeOrgId) return;
    const d = rowDraft[teamId];
    if (!d) return;
    const name = d.name.trim();
    if (!name) {
      alert("Name is required.");
      return;
    }
    setRowSavingId(teamId);
    const { error: uErr } = await supabase
      .from("teams")
      .update({
        name,
        description: d.description.trim() || null,
        manager_user_id: d.manager_user_id || null,
      })
      .eq("id", teamId)
      .eq("organisation_id", activeOrgId);
    setRowSavingId(null);
    if (uErr) {
      console.error(uErr);
      alert(uErr.message || "Could not save team.");
      return;
    }
    await load();
  }

  async function addMemberToTeam(teamId: string) {
    if (!canEdit || !activeOrgId || !addMemberUserId) return;
    setAddMemberSaving(true);
    try {
      const { error: upErr } = await supabase.from("user_team_assignments").upsert(
        {
          organisation_id: activeOrgId,
          user_id: addMemberUserId,
          team_id: teamId,
        },
        { onConflict: "organisation_id,user_id" }
      );
      if (upErr) throw upErr;
      setAddMemberForTeamId(null);
      setAddMemberUserId("");
      await load();
    } catch (e) {
      console.error(e);
      alert(
        e instanceof Error ? e.message : "Could not add member to team."
      );
    } finally {
      setAddMemberSaving(false);
    }
  }

  async function removeMemberFromTeam(teamId: string, userId: string) {
    if (!canEdit || !activeOrgId) return;
    const key = `${teamId}:${userId}`;
    setMemberActionKey(key);
    try {
      const { error: delErr } = await supabase
        .from("user_team_assignments")
        .delete()
        .eq("organisation_id", activeOrgId)
        .eq("user_id", userId)
        .eq("team_id", teamId);
      if (delErr) throw delErr;
      await load();
    } catch (e) {
      console.error(e);
      alert(
        e instanceof Error ? e.message : "Could not remove member from team."
      );
    } finally {
      setMemberActionKey(null);
    }
  }

  async function deleteTeam(teamId: string) {
    if (!canEdit || !activeOrgId) return;
    setRowSavingId(teamId);
    const { error: dErr } = await supabase
      .from("teams")
      .delete()
      .eq("id", teamId)
      .eq("organisation_id", activeOrgId);
    setRowSavingId(null);
    setDeleteConfirmId(null);
    if (dErr) {
      console.error(dErr);
      alert(dErr.message || "Could not delete team.");
      return;
    }
    await load();
  }

  if (!isActive) return null;

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
          Select a workspace to manage teams.
        </p>
      </div>
    );
  }

  const addModalOptions =
    addMemberForTeamId != null
      ? memberOptions.filter((opt) => {
          const onThisTeam = (
            teamMembersByTeamId[addMemberForTeamId] ?? []
          ).some((mem) => mem.userId === opt.user_id);
          return !onThisTeam;
        })
      : [];

  const card: CSSProperties = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box",
  };

  const managerSelect = (value: string, onChange: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, cursor: "pointer", maxWidth: 280 }}
    >
      <option value="">No team lead</option>
      {memberOptions.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.label}
        </option>
      ))}
    </select>
  );

  return (
    <div
      style={{
        maxWidth: 900,
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.55 }}>
        Primary teams and membership are managed here (one team per member per
        workspace). Teams are separate from reporting lines. Capability review
        stays under <strong style={{ color: text }}>Member Capability</strong>.
      </p>

      {canEdit ? (
        <form onSubmit={handleCreate} style={{ ...card, margin: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: mutedColor,
              marginBottom: 12,
            }}
          >
            Create team
          </div>
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "1fr 1fr",
            }}
          >
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span style={{ color: mutedColor }}>Name</span>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                required
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span style={{ color: mutedColor }}>Team lead (optional)</span>
              {managerSelect(createManagerId, setCreateManagerId)}
            </label>
          </div>
          <label
            style={{
              display: "grid",
              gap: 6,
              fontSize: 13,
              marginTop: 12,
            }}
          >
            <span style={{ color: mutedColor }}>Description</span>
            <textarea
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              rows={2}
              style={{
                ...inputStyle,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </label>
          <div style={{ marginTop: 14 }}>
            <button
              type="submit"
              disabled={createSaving}
              style={{ ...btn, fontSize: 13 }}
            >
              {createSaving ? "Creating…" : "Create team"}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p style={{ ...muted, margin: 0 }}>Loading teams…</p>
      ) : error ? (
        <p style={{ margin: 0, color: errorColor }}>{error}</p>
      ) : teams.length === 0 ? (
        <div style={{ ...card, margin: 0 }}>
          <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
            No teams yet. {canEdit ? "Create one above." : ""}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {teams.map((t) => {
            const d = rowDraft[t.id] ?? {
              name: t.name,
              description: t.description ?? "",
              manager_user_id: t.manager_user_id ?? "",
            };
            return (
              <div key={t.id} style={{ ...card, margin: 0 }}>
                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "1fr 1fr",
                  }}
                >
                  <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                    <span style={{ color: mutedColor }}>Name</span>
                    <input
                      value={d.name}
                      disabled={!canEdit || rowSavingId === t.id}
                      onChange={(e) =>
                        setRowDraft((prev) => ({
                          ...prev,
                          [t.id]: {
                            ...d,
                            name: e.target.value,
                          },
                        }))
                      }
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                    <span style={{ color: mutedColor }}>Team lead</span>
                    {canEdit ? (
                      <select
                        value={d.manager_user_id}
                        disabled={rowSavingId === t.id}
                        onChange={(e) =>
                          setRowDraft((prev) => ({
                            ...prev,
                            [t.id]: {
                              ...d,
                              manager_user_id: e.target.value,
                            },
                          }))
                        }
                        style={{ ...inputStyle, cursor: "pointer", maxWidth: 280 }}
                      >
                        <option value="">No team lead</option>
                        {memberOptions.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: 13 }}>
                        {d.manager_user_id
                          ? memberOptions.find(
                              (x) => x.user_id === d.manager_user_id
                            )?.label ?? `${d.manager_user_id.slice(0, 8)}…`
                          : "—"}
                      </span>
                    )}
                  </label>
                </div>
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    marginTop: 12,
                  }}
                >
                  <span style={{ color: mutedColor }}>Description</span>
                  <textarea
                    value={d.description}
                    disabled={!canEdit || rowSavingId === t.id}
                    onChange={(e) =>
                      setRowDraft((prev) => ({
                        ...prev,
                        [t.id]: {
                          ...d,
                          description: e.target.value,
                        },
                      }))
                    }
                    rows={2}
                    style={{
                      ...inputStyle,
                      resize: "vertical",
                      fontFamily: "inherit",
                    }}
                  />
                </label>

                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: mutedColor,
                      }}
                    >
                      Team members
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={rowSavingId === t.id}
                        onClick={() => {
                          setAddMemberUserId("");
                          setAddMemberForTeamId(t.id);
                        }}
                        style={{ ...btn, fontSize: 12, padding: "6px 12px" }}
                      >
                        Add member
                      </button>
                    ) : null}
                  </div>
                  {(teamMembersByTeamId[t.id] ?? []).length === 0 ? (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        color: mutedColor,
                        lineHeight: 1.45,
                      }}
                    >
                      {canEdit
                        ? "No members yet. Use Add member to assign people to this team."
                        : "No members assigned to this team yet."}
                    </p>
                  ) : (
                    <div
                      style={{
                        border: `1px solid ${borderSubtle}`,
                        borderRadius: 8,
                        overflow: "hidden",
                        backgroundColor: "#0c0f14",
                      }}
                    >
                      {(teamMembersByTeamId[t.id] ?? []).map((m, idx) => {
                        const actionKey = `${t.id}:${m.userId}`;
                        const removing = memberActionKey === actionKey;
                        return (
                          <div
                            key={m.userId}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: "8px 10px",
                              borderTop:
                                idx > 0
                                  ? `1px solid ${borderSubtle}`
                                  : undefined,
                              fontSize: 13,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: text,
                                  lineHeight: 1.35,
                                }}
                              >
                                {m.displayName}
                              </div>
                              {m.email ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: mutedColor,
                                    marginTop: 2,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {m.email}
                                </div>
                              ) : null}
                              <div
                                style={{
                                  fontSize: 12,
                                  color: mutedColor,
                                  marginTop: 4,
                                  lineHeight: 1.4,
                                }}
                              >
                                {m.jobTitle ? (
                                  <>
                                    <span style={{ color: text }}>
                                      {m.jobTitle}
                                    </span>
                                    {m.levelName ? (
                                      <span>{` · ${m.levelName}`}</span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span style={{ color: mutedColor }}>
                                    No job profile assigned
                                  </span>
                                )}
                              </div>
                            </div>
                            {canEdit ? (
                              <button
                                type="button"
                                disabled={
                                  removing || rowSavingId === t.id
                                }
                                onClick={() =>
                                  void removeMemberFromTeam(t.id, m.userId)
                                }
                                style={{
                                  ...btnGhost,
                                  fontSize: 12,
                                  color: "#e87878",
                                  flexShrink: 0,
                                  opacity: removing ? 0.6 : 1,
                                }}
                              >
                                {removing ? "…" : "Remove"}
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {canEdit ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      marginTop: 14,
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      disabled={rowSavingId === t.id}
                      onClick={() => void saveTeam(t.id)}
                      style={{ ...btn, fontSize: 13 }}
                    >
                      {rowSavingId === t.id ? "Saving…" : "Save"}
                    </button>
                    {deleteConfirmId === t.id ? (
                      <>
                        <span style={{ fontSize: 13, color: mutedColor }}>
                          Delete this team? Member assignments will be cleared.
                        </span>
                        <button
                          type="button"
                          onClick={() => void deleteTeam(t.id)}
                          style={{
                            ...btn,
                            fontSize: 13,
                            backgroundColor: "#5c2a2a",
                            borderColor: "#7a3838",
                          }}
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          style={{ ...btnGhost, fontSize: 13 }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={rowSavingId === t.id}
                        onClick={() => setDeleteConfirmId(t.id)}
                        style={{ ...btnGhost, fontSize: 13, color: "#e87878" }}
                      >
                        Delete team
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {addMemberForTeamId && canEdit && activeOrgId ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setAddMemberForTeamId(null);
              setAddMemberUserId("");
            }
          }}
        >
          <div
            style={{
              ...card,
              width: "100%",
              maxWidth: 420,
              marginTop: 48,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4
              style={{
                margin: "0 0 6px",
                fontSize: 16,
                fontWeight: 600,
                color: text,
              }}
            >
              Add member to team
            </h4>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 12,
                color: mutedColor,
                lineHeight: 1.45,
              }}
            >
              Assign a workspace member to this team. If they already belong to
              another team, they will move here (one primary team per person).
            </p>
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              <span style={{ color: mutedColor }}>Member</span>
              <select
                value={addMemberUserId}
                onChange={(e) => setAddMemberUserId(e.target.value)}
                style={{
                  ...inputStyle,
                  cursor: "pointer",
                }}
              >
                <option value="">Select a member…</option>
                {addModalOptions.map((opt) => (
                  <option key={opt.user_id} value={opt.user_id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {addModalOptions.length === 0 ? (
              <p style={{ margin: "0 0 12px", fontSize: 12, color: mutedColor }}>
                Everyone in the workspace is already on this team.
              </p>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                disabled={
                  addMemberSaving ||
                  !addMemberUserId ||
                  addModalOptions.length === 0
                }
                onClick={() => void addMemberToTeam(addMemberForTeamId)}
                style={{ ...btn, fontSize: 13 }}
              >
                {addMemberSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={addMemberSaving}
                onClick={() => {
                  setAddMemberForTeamId(null);
                  setAddMemberUserId("");
                }}
                style={{ ...btnGhost, fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

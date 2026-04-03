import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { DevelopmentPlansPanel } from "./DevelopmentPlansPanel";
import { pickPrimaryPlanForReview } from "./hub/developmentPlanPick";
import {
  fetchMyTeamMemberIds,
  isDirectManagerOf,
} from "./hub/reportingLines";
import {
  certificationRenewalStatus,
  certificationStatusLabel,
  sortCertificationsByRenewalUrgency,
} from "./hub/certificationStatus";
import type {
  DevelopmentPlanRow,
  DevelopmentPlanStatus,
  UserCertificationRow,
} from "./hub/types";
import {
  border,
  btnGhost,
  muted,
  mutedColor,
  panelShell,
  surface,
  text,
} from "./hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
};

type MemberSummary = {
  userId: string;
  displayName: string;
  teamName: string | null;
  planStatus: DevelopmentPlanStatus | null;
  planTitle: string | null;
  objectiveCount: number;
  avgProgress: number | null;
  certExpiredCount: number;
  certExpiringSoonCount: number;
};

function certificationRiskLine(expired: number, expiringSoon: number): string {
  if (expired > 0) return `${expired} expired`;
  if (expiringSoon > 0) return `${expiringSoon} expiring soon`;
  return "No certification risks";
}

function formatCertDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function displayNameFromProfile(p: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  return p.email?.trim() || "Team member";
}

function normalizePlan(raw: unknown): DevelopmentPlanRow {
  const r = raw as Record<string, unknown>;
  const st = r.status;
  const status: DevelopmentPlanRow["status"] =
    st === "pending_review"
      ? "submitted"
      : st === "draft" ||
          st === "submitted" ||
          st === "active" ||
          st === "completed" ||
          st === "archived"
        ? st
        : "draft";
  return {
    id: String(r.id),
    organisation_id: String(r.organisation_id),
    user_id: String(r.user_id),
    manager_user_id:
      r.manager_user_id == null ? null : String(r.manager_user_id),
    title: String(r.title ?? ""),
    description:
      r.description === null || r.description === undefined
        ? null
        : String(r.description),
    plan_type:
      r.plan_type === "quarterly" || r.plan_type === "custom"
        ? r.plan_type
        : "annual",
    start_date:
      r.start_date === null || r.start_date === undefined
        ? null
        : String(r.start_date),
    end_date:
      r.end_date === null || r.end_date === undefined
        ? null
        : String(r.end_date),
    status,
    employee_signed_at:
      r.employee_signed_at == null ? null : String(r.employee_signed_at),
    manager_reviewed_at:
      r.manager_reviewed_at == null ? null : String(r.manager_reviewed_at),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

function planStatusLabel(s: DevelopmentPlanStatus): string {
  const map: Record<DevelopmentPlanStatus, string> = {
    draft: "Draft",
    submitted: "Submitted",
    active: "Active",
    completed: "Completed",
    archived: "Archived",
  };
  return map[s] ?? s;
}

export function MyTeamSection({ activeOrgId, isActive }: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<MemberSummary[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedMemberName, setSelectedMemberName] = useState<string>("");
  const [memberEmail, setMemberEmail] = useState<string | null>(null);
  const [memberJobTitle, setMemberJobTitle] = useState<string | null>(null);
  const [memberJobLevel, setMemberJobLevel] = useState<string | null>(null);
  const [memberTeamName, setMemberTeamName] = useState<string | null>(null);
  /** Resolved manager display name from `user_reporting_lines` + profiles, or "No manager assigned". */
  const [memberManagerDisplay, setMemberManagerDisplay] = useState<string | null>(
    null
  );
  const [memberCertifications, setMemberCertifications] = useState<
    UserCertificationRow[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [canManageDirectReport, setCanManageDirectReport] = useState(false);

  const lastDetailMemberDebugId = useRef<string | null>(null);
  const lastReportingLineDebugKey = useRef<string>("");

  const loadTeam = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!activeOrgId || !isActive) {
      if (!silent) setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
    }
    setLoadError(null);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setLoadError("Not signed in.");
      if (!silent) setLoading(false);
      return;
    }
    setCurrentUserId(uid);

    const teamIds = await fetchMyTeamMemberIds(supabase, activeOrgId, uid);
    if (teamIds.length === 0) {
      setSummaries([]);
      if (!silent) setLoading(false);
      return;
    }

    const [profilesRes, assignRes, plansRes, objRes, certRes] =
      await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, first_name, last_name, email")
        .in("id", teamIds),
      supabase
        .from("user_team_assignments")
        .select("user_id, team_id")
        .eq("organisation_id", activeOrgId)
        .in("user_id", teamIds),
      supabase
        .from("development_plans")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .in("user_id", teamIds),
      supabase
        .from("development_plan_objectives")
        .select("development_plan_id, user_id, progress")
        .eq("organisation_id", activeOrgId)
        .in("user_id", teamIds),
      supabase
        .from("user_certifications")
        .select("user_id, expiry_date")
        .eq("organisation_id", activeOrgId)
        .in("user_id", teamIds),
    ]);

    if (certRes.error) {
      console.warn("[my_team] user_certifications:", certRes.error.message);
    }

    const certRiskByUser = new Map<string, { expired: number; soon: number }>();
    for (const id of teamIds) {
      certRiskByUser.set(id, { expired: 0, soon: 0 });
    }
    for (const raw of certRes.data ?? []) {
      const row = raw as { user_id: string; expiry_date: string | null };
      const st = certificationRenewalStatus(row.expiry_date);
      const cur = certRiskByUser.get(row.user_id);
      if (!cur) continue;
      if (st === "expired") cur.expired += 1;
      else if (st === "expiring_soon") cur.soon += 1;
    }

    if (assignRes.error) {
      console.warn("[my_team] user_team_assignments:", assignRes.error.message);
    }

    const userToTeamId = new Map<string, string>();
    for (const a of assignRes.data ?? []) {
      const row = a as { user_id: string; team_id: string };
      userToTeamId.set(row.user_id, row.team_id);
    }
    const primaryTeamIds = [...new Set(userToTeamId.values())];
    const nameByTeamId: Record<string, string> = {};
    if (primaryTeamIds.length > 0) {
      const teamsRes = await supabase
        .from("teams")
        .select("id, name")
        .in("id", primaryTeamIds);
      if (teamsRes.error) {
        console.warn("[my_team] teams:", teamsRes.error.message);
      }
      for (const t of teamsRes.data ?? []) {
        const row = t as { id: string; name: string };
        nameByTeamId[row.id] = row.name;
      }
    }

    if (profilesRes.error) {
      console.error(profilesRes.error);
    }
    const nameById: Record<string, string> = {};
    for (const row of profilesRes.data ?? []) {
      const p = row as {
        id: string;
        display_name?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
      };
      nameById[p.id] = displayNameFromProfile(p);
    }

    const plansByUser: Record<string, DevelopmentPlanRow[]> = {};
    for (const raw of plansRes.data ?? []) {
      const p = normalizePlan(raw);
      if (!plansByUser[p.user_id]) plansByUser[p.user_id] = [];
      plansByUser[p.user_id].push(p);
    }

    const objsByPlan: Record<string, { count: number; sum: number }> = {};
    for (const raw of objRes.data ?? []) {
      const o = raw as {
        development_plan_id: string;
        progress: number | null;
      };
      const pid = o.development_plan_id;
      if (!objsByPlan[pid]) objsByPlan[pid] = { count: 0, sum: 0 };
      objsByPlan[pid].count += 1;
      objsByPlan[pid].sum += Number(o.progress ?? 0);
    }

    const next: MemberSummary[] = teamIds.map((memberId) => {
      const plans = plansByUser[memberId] ?? [];
      const primary = pickPrimaryPlanForReview(plans);
      let objectiveCount = 0;
      let avgProgress: number | null = null;
      if (primary) {
        const agg = objsByPlan[primary.id];
        if (agg && agg.count > 0) {
          objectiveCount = agg.count;
          avgProgress = Math.round(agg.sum / agg.count);
        }
      }
      const tid = userToTeamId.get(memberId);
      const cr = certRiskByUser.get(memberId) ?? { expired: 0, soon: 0 };
      return {
        userId: memberId,
        displayName: nameById[memberId] ?? "Team member",
        teamName: tid ? nameByTeamId[tid] ?? null : null,
        planStatus: primary?.status ?? null,
        planTitle: primary?.title ?? null,
        objectiveCount,
        avgProgress,
        certExpiredCount: cr.expired,
        certExpiringSoonCount: cr.soon,
      };
    });

    setSummaries(next);
    if (!silent) setLoading(false);
  }, [activeOrgId, isActive]);

  const refreshTeamSummaries = useCallback(() => {
    void loadTeam({ silent: true });
  }, [loadTeam]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      void loadTeam();
    });
    return () => {
      cancelled = true;
    };
  }, [loadTeam]);

  useEffect(() => {
    if (!activeOrgId || !selectedMemberId || !currentUserId) {
      void Promise.resolve().then(() => {
        setMemberEmail(null);
        setMemberJobTitle(null);
        setMemberJobLevel(null);
        setMemberTeamName(null);
        setMemberManagerDisplay(null);
        setMemberCertifications([]);
        setCanManageDirectReport(false);
        setDetailLoading(false);
        lastDetailMemberDebugId.current = null;
        lastReportingLineDebugKey.current = "";
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setDetailLoading(true);
      setMemberManagerDisplay(null);
      if (import.meta.env.DEV) {
        if (lastDetailMemberDebugId.current !== selectedMemberId) {
          lastDetailMemberDebugId.current = selectedMemberId;
          console.log("[my_team_debug] detail selectedMemberId", selectedMemberId, {
            activeOrgId,
            currentUserId,
          });
        }
      }
      const ok = await isDirectManagerOf(
        supabase,
        activeOrgId,
        currentUserId,
        selectedMemberId
      );
      if (cancelled) return;
      setCanManageDirectReport(ok);

      const [profRes, assignRes, ujpRes, certsRes, lineRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, email, display_name, first_name, last_name")
          .eq("id", selectedMemberId)
          .maybeSingle(),
        supabase
          .from("user_team_assignments")
          .select("team_id")
          .eq("organisation_id", activeOrgId)
          .eq("user_id", selectedMemberId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("user_job_profiles")
          .select("job_profile_id")
          .eq("organisation_id", activeOrgId)
          .eq("user_id", selectedMemberId)
          .maybeSingle(),
        supabase
          .from("user_certifications")
          .select(
            "id, organisation_id, user_id, title, issuer, issue_date, expiry_date, renewal_required, notes, credential_url, created_at, updated_at"
          )
          .eq("organisation_id", activeOrgId)
          .eq("user_id", selectedMemberId)
          .order("created_at", { ascending: false }),
        supabase
          .from("user_reporting_lines")
          .select("manager_user_id")
          .eq("organisation_id", activeOrgId)
          .eq("user_id", selectedMemberId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (import.meta.env.DEV) {
        const rk = `${selectedMemberId}:${lineRes.error?.message ?? ""}:${JSON.stringify(lineRes.data)}`;
        if (rk !== lastReportingLineDebugKey.current) {
          lastReportingLineDebugKey.current = rk;
          console.log("[my_team_debug] user_reporting_lines for member", {
            error: lineRes.error?.message,
            data: lineRes.data,
          });
        }
      }

      let managerLabel: string | null = null;
      if (!lineRes.error && lineRes.data) {
        const mid = (lineRes.data as { manager_user_id: string }).manager_user_id;
        if (mid) {
          const mprofRes = await supabase
            .from("profiles")
            .select("display_name, first_name, last_name, email")
            .eq("id", mid)
            .maybeSingle();
          if (!cancelled && !mprofRes.error && mprofRes.data) {
            managerLabel = displayNameFromProfile(
              mprofRes.data as {
                display_name?: string | null;
                first_name?: string | null;
                last_name?: string | null;
                email?: string | null;
              }
            );
            if (mid === currentUserId) {
              managerLabel = `${managerLabel} (you)`;
            }
          } else if (!cancelled) {
            managerLabel = `${mid.slice(0, 8)}…`;
          }
        }
      }
      setMemberManagerDisplay(managerLabel ?? "No manager assigned");

      if (certsRes.error) {
        console.warn("[my_team] user_certifications detail:", certsRes.error.message);
        setMemberCertifications([]);
      } else {
        const rows = (certsRes.data ?? []) as UserCertificationRow[];
        setMemberCertifications(sortCertificationsByRenewalUrgency(rows));
      }

      const p = profRes.data as { email?: string | null } | null;
      setMemberEmail(p?.email?.trim() ?? null);

      let teamName: string | null = null;
      if (!assignRes.error && assignRes.data) {
        const tid = (assignRes.data as { team_id: string }).team_id;
        const tRes = await supabase
          .from("teams")
          .select("name")
          .eq("id", tid)
          .maybeSingle();
        if (!cancelled && !tRes.error && tRes.data) {
          teamName =
            String((tRes.data as { name: string }).name ?? "").trim() || null;
        }
      }
      setMemberTeamName(teamName);

      let jpTitle: string | null = null;
      let jpLevel: string | null = null;
      if (!ujpRes.error && ujpRes.data) {
        const jid = (ujpRes.data as { job_profile_id: string | null })
          .job_profile_id;
        if (jid) {
          const jpRes = await supabase
            .from("job_profiles")
            .select("title, level_name")
            .eq("id", jid)
            .maybeSingle();
          if (!cancelled && !jpRes.error && jpRes.data) {
            const jp = jpRes.data as {
              title: string;
              level_name: string | null;
            };
            jpTitle = jp.title;
            jpLevel = jp.level_name;
          }
        }
      }
      setMemberJobTitle(jpTitle);
      setMemberJobLevel(jpLevel);
      setDetailLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, selectedMemberId, currentUserId]);

  if (!isActive) {
    return null;
  }

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to view your team.
        </p>
      </div>
    );
  }

  if (loading || !currentUserId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <p style={{ marginTop: 0, fontSize: 14, color: "#e87878" }}>{loadError}</p>
    );
  }

  if (selectedMemberId) {
    const card = {
      padding: "16px 18px",
      borderRadius: 10,
      backgroundColor: surface,
      border: `1px solid ${border}`,
      boxSizing: "border-box" as const,
    };
    return (
      <div
        style={{
          maxWidth: 760,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setSelectedMemberId(null);
            setSelectedMemberName("");
          }}
          style={{ ...btnGhost, fontSize: 13, alignSelf: "flex-start" }}
        >
          ← Back to team
        </button>

        <div style={card}>
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
            Team member
          </p>
          {detailLoading ? (
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              Loading profile…
            </p>
          ) : (
            <>
              <h3
                style={{
                  margin: "0 0 8px",
                  fontSize: 20,
                  fontWeight: 600,
                  color: text,
                  letterSpacing: "-0.02em",
                }}
              >
                {selectedMemberName}
              </h3>
              {memberEmail ? (
                <p style={{ margin: "0 0 10px", fontSize: 14, color: text }}>
                  <span style={{ color: mutedColor }}>Email </span>
                  <a
                    href={`mailto:${memberEmail}`}
                    style={{ color: text, textDecoration: "underline" }}
                  >
                    {memberEmail}
                  </a>
                </p>
              ) : (
                <p style={{ margin: "0 0 10px", fontSize: 14, color: mutedColor }}>
                  Email not on profile.
                </p>
              )}
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  fontSize: 14,
                  color: mutedColor,
                  lineHeight: 1.5,
                }}
              >
                <p style={{ margin: 0 }}>
                  <span style={{ color: mutedColor }}>Team </span>
                  <span style={{ color: text }}>
                    {memberTeamName ?? "—"}
                  </span>
                </p>
                <p style={{ margin: 0 }}>
                  <span style={{ color: mutedColor }}>Manager </span>
                  <span style={{ color: text }}>
                    {memberManagerDisplay ?? "—"}
                  </span>
                </p>
                <p style={{ margin: 0 }}>
                  <span style={{ color: mutedColor }}>Job profile </span>
                  <span style={{ color: text }}>
                    {memberJobTitle ?? "—"}
                    {memberJobLevel ? (
                      <span style={{ color: mutedColor }}>
                        {" "}
                        · {memberJobLevel}
                      </span>
                    ) : null}
                  </span>
                </p>
              </div>
            </>
          )}
        </div>

        {!detailLoading ? (
          <div style={card}>
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
              Certifications
            </p>
            {memberCertifications.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                No certifications recorded for this workspace.
              </p>
            ) : (
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {memberCertifications.map((c) => {
                  const st = certificationRenewalStatus(c.expiry_date);
                  const badgeLabel = certificationStatusLabel(st);
                  const badgeColor =
                    st === "expired"
                      ? "#e87878"
                      : st === "expiring_soon"
                        ? "#e8c96a"
                        : mutedColor;
                  return (
                    <li
                      key={c.id}
                      style={{
                        paddingBottom: 10,
                        borderBottom: `1px solid ${border}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            color: text,
                          }}
                        >
                          {c.title}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 6,
                            border: `1px solid ${border}`,
                            color: badgeColor,
                          }}
                        >
                          {badgeLabel}
                        </span>
                      </div>
                      {c.issuer ? (
                        <div
                          style={{
                            fontSize: 13,
                            color: mutedColor,
                            marginTop: 4,
                          }}
                        >
                          {c.issuer}
                        </div>
                      ) : null}
                      <div
                        style={{
                          fontSize: 12,
                          color: mutedColor,
                          marginTop: 6,
                        }}
                      >
                        {c.expiry_date
                          ? `Expires ${formatCertDate(c.expiry_date)}`
                          : "No expiry date"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <DevelopmentPlansPanel
          activeOrgId={activeOrgId}
          currentUserId={currentUserId}
          subjectUserId={selectedMemberId}
          subjectDisplayName={selectedMemberName}
          canManageDirectReport={canManageDirectReport}
          onPlansChanged={refreshTeamSummaries}
        />
      </div>
    );
  }

  const card = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  return (
    <div
      style={{
        maxWidth: 720,
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <header>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: text,
            letterSpacing: "-0.02em",
          }}
        >
          My Team
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          People who report to you in this workspace. Open a member to review
          their development plans, objectives, and notes.
        </p>
      </header>

      {summaries.length === 0 ? (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
            No direct reports yet. Reporting lines can be assigned so managers
            can review development plans in context.
          </p>
        </div>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {summaries.map((m) => (
            <li key={m.userId} style={{ ...card, margin: 0 }}>
              <button
                type="button"
                onClick={() => {
                  setSelectedMemberId(m.userId);
                  setSelectedMemberName(m.displayName);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: text,
                }}
              >
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  {m.displayName}
                </div>
                {m.teamName ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: mutedColor,
                      marginBottom: 8,
                    }}
                  >
                    Team:{" "}
                    <span style={{ color: text, fontWeight: 500 }}>
                      {m.teamName}
                    </span>
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: 13,
                    color: mutedColor,
                    lineHeight: 1.55,
                  }}
                >
                  {m.planTitle ? (
                    <>
                      <span style={{ color: text, fontWeight: 500 }}>
                        {m.planTitle}
                      </span>
                      {" · "}
                    </>
                  ) : (
                    "No plan · "
                  )}
                  Plan status:{" "}
                  <strong style={{ color: text }}>
                    {m.planStatus ? planStatusLabel(m.planStatus) : "—"}
                  </strong>
                  <br />
                  Objectives:{" "}
                  <strong style={{ color: text }}>{m.objectiveCount}</strong>
                  {m.avgProgress != null ? (
                    <>
                      {" "}
                      · Avg progress:{" "}
                      <strong style={{ color: text }}>{m.avgProgress}%</strong>
                    </>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: mutedColor,
                    marginTop: 10,
                  }}
                >
                  Certifications:{" "}
                  <span
                    style={{
                      color:
                        m.certExpiredCount > 0
                          ? "#e87878"
                          : m.certExpiringSoonCount > 0
                            ? "#e8c96a"
                            : mutedColor,
                    }}
                  >
                    {certificationRiskLine(
                      m.certExpiredCount,
                      m.certExpiringSoonCount
                    )}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

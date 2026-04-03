import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { DevelopmentPlansPanel } from "./DevelopmentPlansPanel";
import type { DevelopmentGoalNoteRow, DevelopmentGoalRow } from "./hub/types";
import {
  DevelopmentGoalInlineDetail,
  normalizeDevelopmentGoal,
} from "./hub/DevelopmentGoalInlineDetail";
import {
  accent,
  bg,
  border,
  borderSubtle,
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

type DevTab = "goals" | "plans";

const GOAL_SELECT =
  "id, organisation_id, user_id, competency_id, current_level, target_level, relevance, title, description, suggested_actions, status, progress, created_at, updated_at, lifecycle_status, career_focus_source_id, competencies ( name )";

export function MyDevelopmentSection({ activeOrgId, isActive }: Props) {
  const [devTab, setDevTab] = useState<DevTab>("goals");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [goals, setGoals] = useState<DevelopmentGoalRow[]>([]);
  const [backlogGoals, setBacklogGoals] = useState<DevelopmentGoalRow[]>([]);
  const [completedGoals, setCompletedGoals] = useState<DevelopmentGoalRow[]>(
    []
  );
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [progressDraft, setProgressDraft] = useState<Record<string, number>>(
    {}
  );
  const [goalActionLoading, setGoalActionLoading] = useState<string | null>(
    null
  );
  const [notesByGoalId, setNotesByGoalId] = useState<
    Record<string, DevelopmentGoalNoteRow[]>
  >({});
  const [goalNoteDraft, setGoalNoteDraft] = useState<Record<string, string>>(
    {}
  );

  const fetchGoals = useCallback(async (orgId: string, uid: string) => {
    setGoalsLoading(true);
    const q = () =>
      supabase
        .from("development_goals")
        .select(GOAL_SELECT)
        .eq("organisation_id", orgId)
        .eq("user_id", uid);

    const [backlogRes, activeRes, completedRes] = await Promise.all([
      q().eq("lifecycle_status", "backlog").order("updated_at", { ascending: false }),
      q()
        .eq("lifecycle_status", "active")
        .in("status", ["not_started", "in_progress"])
        .order("updated_at", { ascending: false })
        .limit(5),
      q()
        .eq("lifecycle_status", "completed")
        .order("updated_at", { ascending: false })
        .limit(5),
    ]);

    if (backlogRes.error) console.error(backlogRes.error);
    if (activeRes.error) console.error(activeRes.error);
    if (completedRes.error) console.error(completedRes.error);

    setBacklogGoals((backlogRes.data ?? []).map(normalizeDevelopmentGoal));
    setGoals((activeRes.data ?? []).map(normalizeDevelopmentGoal));
    setCompletedGoals((completedRes.data ?? []).map(normalizeDevelopmentGoal));
    setGoalsLoading(false);
  }, []);

  const loadData = useCallback(async () => {
    if (!isActive || !activeOrgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      setLoadError("Not signed in.");
      setLoading(false);
      return;
    }
    const uid = user.id;
    setCurrentUserId(uid);
    await fetchGoals(activeOrgId, uid);
    setLoading(false);
  }, [isActive, activeOrgId, fetchGoals]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadNotesForGoal = useCallback(async (goalId: string) => {
    const { data, error } = await supabase
      .from("development_goal_notes")
      .select("id, goal_id, note, progress_snapshot, created_at")
      .eq("goal_id", goalId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error(error);
      return;
    }
    const rows = (data ?? []) as DevelopmentGoalNoteRow[];
    setNotesByGoalId((prev) => ({ ...prev, [goalId]: rows }));
  }, []);

  useEffect(() => {
    if (!expandedGoalId) return;
    void loadNotesForGoal(expandedGoalId);
  }, [expandedGoalId, loadNotesForGoal]);

  async function handleSaveProgressWithNote(
    goalId: string,
    progress: number,
    noteText: string
  ) {
    if (!activeOrgId || !currentUserId) return;
    const p = Math.max(0, Math.min(100, Math.round(progress)));
    const nextStatus =
      p >= 100 ? "completed" : p > 0 ? "in_progress" : "not_started";
    const trimmedNote = noteText.trim();
    setGoalActionLoading(goalId);
    const { error } = await supabase
      .from("development_goals")
      .update({
        progress: p,
        status: nextStatus,
        ...(p >= 100 ? { lifecycle_status: "completed" as const } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", goalId)
      .eq("user_id", currentUserId);
    if (error) {
      setGoalActionLoading(null);
      console.error(error);
      alert(error.message || "Could not update progress.");
      return;
    }
    if (trimmedNote) {
      const { error: noteErr } = await supabase
        .from("development_goal_notes")
        .insert({
          goal_id: goalId,
          note: trimmedNote,
          progress_snapshot: p,
        });
      if (noteErr) {
        console.error(noteErr);
        alert(noteErr.message || "Could not save note.");
        setGoalActionLoading(null);
        return;
      }
      setGoalNoteDraft((d) => ({ ...d, [goalId]: "" }));
    }
    setGoalActionLoading(null);
    await fetchGoals(activeOrgId, currentUserId);
    await loadNotesForGoal(goalId);
    if (p >= 100) {
      setExpandedGoalId(null);
    }
  }

  async function handleMarkComplete(goalId: string) {
    if (!activeOrgId || !currentUserId) return;
    setGoalActionLoading(goalId);
    const { error } = await supabase
      .from("development_goals")
      .update({
        progress: 100,
        status: "completed",
        lifecycle_status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", goalId)
      .eq("user_id", currentUserId);
    setGoalActionLoading(null);
    if (error) {
      console.error(error);
      alert(error.message || "Could not complete goal.");
      return;
    }
    setExpandedGoalId(null);
    await fetchGoals(activeOrgId, currentUserId);
  }

  if (!isActive) {
    return null;
  }

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to manage your development.
        </p>
      </div>
    );
  }

  if (loading) {
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

  const card = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  function tabStyle(active: boolean) {
    return {
      ...btnGhost,
      fontSize: 13,
      padding: "8px 4px",
      borderRadius: 0,
      borderBottom: active
        ? `2px solid ${accent}`
        : `2px solid transparent`,
      color: active ? text : mutedColor,
      fontWeight: active ? 600 : 500,
    } as const;
  }

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
          My Development
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          Track day-to-day goals and backlog, or structure formal plans for
          review cycles.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 20px",
          borderBottom: `1px solid ${borderSubtle}`,
        }}
      >
        <button
          type="button"
          onClick={() => setDevTab("goals")}
          style={tabStyle(devTab === "goals")}
        >
          Goals &amp; backlog
        </button>
        <button
          type="button"
          onClick={() => setDevTab("plans")}
          style={tabStyle(devTab === "plans")}
        >
          Development plans
        </button>
      </div>

      {devTab === "plans" && currentUserId ? (
        <DevelopmentPlansPanel
          activeOrgId={activeOrgId}
          currentUserId={currentUserId}
        />
      ) : null}

      {devTab === "goals" ? (
      <section>
        {goalsLoading ? (
          <p style={{ ...muted, margin: 0, fontSize: 13 }}>Loading goals…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div>
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: mutedColor,
                }}
              >
                Backlog
              </p>
              {backlogGoals.length === 0 ? (
                <div style={card}>
                  <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                    No backlog items yet. Save career-linked suggestions from{" "}
                    <span style={{ color: text, fontWeight: 500 }}>My Career</span>{" "}
                    to queue future development focus without starting active goals.
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
                    gap: 8,
                  }}
                >
                  {backlogGoals.map((g) => (
                    <li
                      key={g.id}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 8,
                        border: `1px solid ${borderSubtle}`,
                        backgroundColor: bg,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                          justifyContent: "space-between",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: text,
                          }}
                        >
                          {g.title}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            padding: "3px 8px",
                            borderRadius: 6,
                            border: `1px solid ${borderSubtle}`,
                            color: mutedColor,
                          }}
                        >
                          {g.career_focus_source_id ? "Career-linked" : "Backlog"}
                        </span>
                      </div>
                      {g.description ? (
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 13,
                            color: mutedColor,
                            lineHeight: 1.5,
                          }}
                        >
                          {g.description}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: mutedColor,
                }}
              >
                Active
              </p>
              {goals.length === 0 ? (
                <div style={card}>
                  <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                    No active goals yet. Use{" "}
                    <span style={{ color: text, fontWeight: 500 }}>Improve this</span>{" "}
                    on a focus area on{" "}
                    <span style={{ color: text, fontWeight: 500 }}>My Dashboard</span>{" "}
                    to create one.
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
                  {goals.map((g) => {
                    const expanded = expandedGoalId === g.id;
                    const prog =
                      progressDraft[g.id] !== undefined
                        ? progressDraft[g.id]
                        : g.progress;
                    return (
                      <li key={g.id} style={{ ...card, margin: 0 }}>
                        <DevelopmentGoalInlineDetail
                          goal={g}
                          variant="dashboard"
                          expanded={expanded}
                          onToggleExpand={() => {
                            setExpandedGoalId(expanded ? null : g.id);
                            setProgressDraft((d) => ({ ...d, [g.id]: g.progress }));
                            if (!expanded) {
                              setGoalNoteDraft((d) => ({ ...d, [g.id]: "" }));
                            }
                          }}
                          progressDraft={prog}
                          onProgressDraftChange={(v) =>
                            setProgressDraft((d) => ({ ...d, [g.id]: v }))
                          }
                          goalNoteDraft={goalNoteDraft[g.id] ?? ""}
                          onGoalNoteDraftChange={(v) =>
                            setGoalNoteDraft((d) => ({ ...d, [g.id]: v }))
                          }
                          notes={notesByGoalId[g.id] ?? []}
                          onSaveProgress={() =>
                            void handleSaveProgressWithNote(
                              g.id,
                              prog,
                              goalNoteDraft[g.id] ?? ""
                            )
                          }
                          onMarkComplete={() => void handleMarkComplete(g.id)}
                          actionLoading={goalActionLoading === g.id}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: mutedColor,
                }}
              >
                Completed
              </p>
              {completedGoals.length === 0 ? (
                <div style={card}>
                  <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                    No completed goals in this workspace yet.
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
                    gap: 8,
                  }}
                >
                  {completedGoals.map((g) => (
                    <li
                      key={g.id}
                      style={{
                        ...card,
                        margin: 0,
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "baseline",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: text,
                          }}
                        >
                          {g.title}
                        </span>
                        <span style={{ fontSize: 12, color: mutedColor }}>
                          {new Date(g.updated_at).toLocaleDateString(undefined, {
                            dateStyle: "medium",
                          })}
                        </span>
                      </div>
                      {g.description ? (
                        <p
                          style={{
                            margin: "6px 0 0",
                            fontSize: 13,
                            color: mutedColor,
                            lineHeight: 1.45,
                          }}
                        >
                          {g.description}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
      ) : null}
    </div>
  );
}

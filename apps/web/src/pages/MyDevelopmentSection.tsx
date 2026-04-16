import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { DevelopmentPlansPanel } from "./DevelopmentPlansPanel";
import styles from "./MyDevelopmentSection.module.css";
import type {
  DevelopmentFocusItemRow,
  DevelopmentFocusItemStatus,
  DevelopmentGoalNoteRow,
  DevelopmentGoalRow,
  DevelopmentFocusUpdateRow,
} from "./hub/types";
import {
  addDevelopmentFocusItem,
  addUpdateForFocusItem,
  archiveDevelopmentFocusItem,
  deleteDevelopmentFocusItem,
  listUpdatesForFocusItem,
  listPersonalDevelopmentFocusItems,
  setDevelopmentFocusItemDueDate,
  updateDevelopmentFocusItemStatus,
} from "./hub/developmentFocusItemsApi";
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
  surfaceHover,
  text,
} from "./hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  primaryAccountType: string | null;
  primaryAccountTypeReady: boolean;
};

type DevTab = "goals" | "plans";

const GOAL_SELECT =
  "id, organisation_id, user_id, competency_id, current_level, target_level, relevance, title, description, suggested_actions, status, progress, created_at, updated_at, lifecycle_status, career_focus_source_id, competencies ( name )";

function focusItemStatusLabel(status: DevelopmentFocusItemStatus): string {
  switch (status) {
    case "backlog":
      return "Backlog";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "complete":
      return "Complete";
    default:
      return status;
  }
}

export function MyDevelopmentSection({
  activeOrgId,
  isActive,
  primaryAccountType,
  primaryAccountTypeReady,
}: Props) {
  const [devTab, setDevTab] = useState<DevTab>("goals");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [personalStandaloneNoOrg, setPersonalStandaloneNoOrg] =
    useState(false);
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

  const [personalItems, setPersonalItems] = useState<DevelopmentFocusItemRow[]>(
    []
  );
  const [personalAddTitle, setPersonalAddTitle] = useState("");
  const [personalAddDesc, setPersonalAddDesc] = useState("");
  const [personalSaving, setPersonalSaving] = useState(false);
  const [personalActionId, setPersonalActionId] = useState<string | null>(null);
  const [expandedPersonalItemId, setExpandedPersonalItemId] = useState<
    string | null
  >(null);
  /** When true, Kanban card body is collapsed to title + minimal metadata only. */
  const [personalKanbanCollapsedById, setPersonalKanbanCollapsedById] = useState<
    Record<string, boolean>
  >({});
  const [updatesByItemId, setUpdatesByItemId] = useState<
    Record<string, DevelopmentFocusUpdateRow[]>
  >({});
  const [updateDraftByItemId, setUpdateDraftByItemId] = useState<
    Record<string, string>
  >({});

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
    if (!isActive) {
      setLoading(false);
      return;
    }

    const isPersonalStandalone =
      primaryAccountType === "personal" && !activeOrgId;

    if (isPersonalStandalone) {
      setLoading(true);
      setLoadError(null);
      setPersonalStandaloneNoOrg(true);
      setBacklogGoals([]);
      setGoals([]);
      setCompletedGoals([]);
      setPersonalItems([]);

      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        setLoadError("Not signed in.");
        setPersonalStandaloneNoOrg(false);
        setLoading(false);
        return;
      }
      setCurrentUserId(user.id);
      try {
        const rows = await listPersonalDevelopmentFocusItems();
        setPersonalItems(rows);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load items.");
      }
      setLoading(false);
      return;
    }

    setPersonalStandaloneNoOrg(false);

    if (!activeOrgId) {
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
  }, [isActive, activeOrgId, primaryAccountType, fetchGoals]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!personalStandaloneNoOrg) return;
    if (!expandedPersonalItemId) return;
    if (updatesByItemId[expandedPersonalItemId]) return;
    void (async () => {
      try {
        const rows = await listUpdatesForFocusItem(expandedPersonalItemId);
        setUpdatesByItemId((prev) => ({ ...prev, [expandedPersonalItemId]: rows }));
      } catch (e) {
        console.warn(
          "development_focus_updates load:",
          e instanceof Error ? e.message : String(e),
        );
      }
    })();
  }, [personalStandaloneNoOrg, expandedPersonalItemId, updatesByItemId]);

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

  if (!activeOrgId && !primaryAccountTypeReady) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading…</p>
      </div>
    );
  }

  if (!activeOrgId && primaryAccountType !== "personal") {
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

  if (personalStandaloneNoOrg) {
    const personalCard = {
      padding: "16px 18px",
      borderRadius: 10,
      backgroundColor: surface,
      border: `1px solid ${border}`,
      boxSizing: "border-box" as const,
    };

    const formatShortDate = (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    };

    const kanbanCols: Array<{ key: DevelopmentFocusItemStatus; label: string }> = [
      { key: "backlog", label: "Backlog" },
      { key: "in_progress", label: "In Progress" },
      { key: "blocked", label: "Blocked" },
      { key: "complete", label: "Complete" },
    ];

    return (
      <div className={styles.shell} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
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

        <section>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 600,
              color: mutedColor,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Backlog
          </p>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 14,
              color: mutedColor,
              lineHeight: 1.55,
            }}
          >
            Store personal development focus items here — no workspace required.
          </p>

          <div style={{ ...personalCard, marginTop: 12, display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Title
              <input
                value={personalAddTitle}
                onChange={(e) => setPersonalAddTitle(e.target.value)}
                placeholder="e.g. Programme delivery leadership"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  boxSizing: "border-box" as const,
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Description (optional)
              <textarea
                value={personalAddDesc}
                onChange={(e) => setPersonalAddDesc(e.target.value)}
                rows={3}
                placeholder="What would you work on? Why now?"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  boxSizing: "border-box" as const,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                }}
              />
            </label>
            <button
              type="button"
              disabled={personalSaving || !personalAddTitle.trim()}
              onClick={async () => {
                if (!personalAddTitle.trim()) return;
                setPersonalSaving(true);
                setLoadError(null);
                try {
                  const row = await addDevelopmentFocusItem({
                    organisation_id: null,
                    title: personalAddTitle,
                    description: personalAddDesc,
                    source: "manual",
                    related_signals: {},
                    status: "backlog",
                  });
                  setPersonalItems((prev) => [row, ...prev]);
                  setPersonalAddTitle("");
                  setPersonalAddDesc("");
                } catch (e) {
                  setLoadError(
                    e instanceof Error ? e.message : "Could not add item.",
                  );
                } finally {
                  setPersonalSaving(false);
                }
              }}
              style={{
                padding: "9px 16px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                color: text,
                backgroundColor: bg,
                border: `1px solid ${border}`,
                borderRadius: 8,
                justifySelf: "start",
                opacity: personalSaving || !personalAddTitle.trim() ? 0.6 : 1,
              }}
            >
              {personalSaving ? "Adding…" : "Add to backlog"}
            </button>
          </div>
        </section>

        <section>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 600,
              color: mutedColor,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Board
          </p>

          <div className={styles.kanbanGrid} style={{ marginTop: 10 }}>
            {kanbanCols.map((col) => {
              const rows = personalItems.filter(
                (x) => x.status === col.key && !x.archived,
              );
              return (
                <div key={col.key} className={styles.kanbanCol}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      color: mutedColor,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {col.label} <span style={{ color: mutedColor }}>· {rows.length}</span>
                  </p>

                  {rows.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>—</p>
                  ) : (
                    rows.map((r) => {
                      const updatesOpen = expandedPersonalItemId === r.id;
                      const updates = updatesByItemId[r.id] ?? [];
                      const dueIso = r.due_date?.trim() || "";
                      const dueInput =
                        dueIso && !Number.isNaN(new Date(dueIso).getTime())
                          ? new Date(dueIso).toISOString().slice(0, 10)
                          : "";
                      const isCollapsed = personalKanbanCollapsedById[r.id] === true;
                      const statusBtn = {
                        ...btnGhost,
                        fontSize: 12,
                        padding: "6px 10px",
                        fontWeight: 600,
                        color: text,
                        flexShrink: 0,
                      } as const;
                      const archiveDeleteBtn = {
                        ...btnGhost,
                        fontSize: 12,
                        padding: "6px 10px",
                        fontWeight: 400,
                        color: mutedColor,
                        opacity: 0.92,
                        flexShrink: 0,
                      } as const;

                      return (
                        <div
                          key={r.id}
                          style={{
                            padding: "12px 14px",
                            borderRadius: 10,
                            backgroundColor: surface,
                            border: `1px solid ${borderSubtle}`,
                            display: "grid",
                            gap: isCollapsed ? 0 : 10,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "flex-start",
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                              {!isCollapsed ? (
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    flexWrap: "wrap",
                                    alignItems: "baseline",
                                  }}
                                >
                                  <p
                                    style={{
                                      margin: 0,
                                      fontSize: 14,
                                      fontWeight: 600,
                                      color: text,
                                    }}
                                  >
                                    {r.title}
                                  </p>
                                  <span style={{ fontSize: 11, color: mutedColor }}>
                                    {r.source}
                                  </span>
                                </div>
                              ) : (
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: text,
                                  }}
                                >
                                  {r.title}
                                </p>
                              )}
                              {isCollapsed ? (
                                <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
                                  <span style={{ color: text, fontWeight: 600 }}>
                                    {focusItemStatusLabel(r.status)}
                                  </span>
                                  {" · "}
                                  Due: {dueIso ? formatShortDate(dueIso) : "—"}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              aria-expanded={!isCollapsed}
                              title={isCollapsed ? "Expand card" : "Collapse card"}
                              onClick={() => {
                                setPersonalKanbanCollapsedById((prev) => {
                                  const wasCollapsed = prev[r.id] === true;
                                  if (!wasCollapsed) {
                                    setExpandedPersonalItemId((exp) =>
                                      exp === r.id ? null : exp,
                                    );
                                  }
                                  return { ...prev, [r.id]: !wasCollapsed };
                                });
                              }}
                              style={{
                                ...btnGhost,
                                flexShrink: 0,
                                fontSize: 14,
                                lineHeight: 1,
                                padding: "4px 8px",
                                minWidth: 28,
                                color: mutedColor,
                              }}
                            >
                              {isCollapsed ? "▸" : "▾"}
                            </button>
                          </div>

                          {!isCollapsed ? (
                            <>
                              {r.description?.trim() ? (
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 13,
                                    color: mutedColor,
                                    lineHeight: 1.5,
                                  }}
                                >
                                  {r.description}
                                </p>
                              ) : null}

                              <label
                                style={{
                                  display: "grid",
                                  gap: 6,
                                  fontSize: 12,
                                  color: mutedColor,
                                }}
                              >
                                Due date
                                <input
                                  type="date"
                                  value={dueInput}
                                  onChange={async (e) => {
                                    const v = e.target.value;
                                    setPersonalActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      const iso = v
                                        ? new Date(`${v}T12:00:00.000Z`).toISOString()
                                        : null;
                                      await setDevelopmentFocusItemDueDate({
                                        id: r.id,
                                        due_date: iso,
                                      });
                                      setPersonalItems((prev) =>
                                        prev.map((x) =>
                                          x.id === r.id ? { ...x, due_date: iso } : x,
                                        ),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not set due date.",
                                      );
                                    } finally {
                                      setPersonalActionId(null);
                                    }
                                  }}
                                  style={{
                                    width: "100%",
                                    padding: "8px 10px",
                                    fontSize: 13,
                                    color: text,
                                    backgroundColor: bg,
                                    border: `1px solid ${border}`,
                                    borderRadius: 8,
                                    boxSizing: "border-box" as const,
                                  }}
                                />
                              </label>

                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "nowrap",
                                  gap: 6,
                                  alignItems: "center",
                                  overflowX: "auto",
                                  paddingBottom: 2,
                                  WebkitOverflowScrolling: "touch",
                                }}
                              >
                                <button
                                  type="button"
                                  disabled={
                                    personalActionId === r.id || r.status === "backlog"
                                  }
                                  style={statusBtn}
                                  onClick={async () => {
                                    setPersonalActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      await updateDevelopmentFocusItemStatus({
                                        id: r.id,
                                        status: "backlog",
                                      });
                                      setPersonalItems((prev) =>
                                        prev.map((x) =>
                                          x.id === r.id ? { ...x, status: "backlog" } : x,
                                        ),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not move item.",
                                      );
                                    } finally {
                                      setPersonalActionId(null);
                                    }
                                  }}
                                >
                                  Backlog
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    personalActionId === r.id ||
                                    r.status === "in_progress"
                                  }
                                  style={statusBtn}
                                  onClick={async () => {
                                    setPersonalActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      await updateDevelopmentFocusItemStatus({
                                        id: r.id,
                                        status: "in_progress",
                                      });
                                      setPersonalItems((prev) =>
                                        prev.map((x) =>
                                          x.id === r.id
                                            ? { ...x, status: "in_progress" }
                                            : x,
                                        ),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not move item.",
                                      );
                                    } finally {
                                      setPersonalActionId(null);
                                    }
                                  }}
                                >
                                  In progress
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    personalActionId === r.id || r.status === "blocked"
                                  }
                                  style={statusBtn}
                                  onClick={async () => {
                                    setPersonalActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      await updateDevelopmentFocusItemStatus({
                                        id: r.id,
                                        status: "blocked",
                                      });
                                      setPersonalItems((prev) =>
                                        prev.map((x) =>
                                          x.id === r.id ? { ...x, status: "blocked" } : x,
                                        ),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not move item.",
                                      );
                                    } finally {
                                      setPersonalActionId(null);
                                    }
                                  }}
                                >
                                  Blocked
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    personalActionId === r.id || r.status === "complete"
                                  }
                                  style={statusBtn}
                                  onClick={async () => {
                                    setPersonalActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      await updateDevelopmentFocusItemStatus({
                                        id: r.id,
                                        status: "complete",
                                      });
                                      setPersonalItems((prev) =>
                                        prev.map((x) =>
                                          x.id === r.id ? { ...x, status: "complete" } : x,
                                        ),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not move item.",
                                      );
                                    } finally {
                                      setPersonalActionId(null);
                                    }
                                  }}
                                >
                                  Complete
                                </button>
                                <span
                                  aria-hidden
                                  style={{
                                    display: "inline-block",
                                    width: 1,
                                    height: 14,
                                    background: borderSubtle,
                                    flexShrink: 0,
                                    margin: "0 2px",
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={personalActionId === r.id}
                                  style={archiveDeleteBtn}
                                  onClick={async () => {
                                    setPersonalActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      await archiveDevelopmentFocusItem(r.id);
                                      setPersonalItems((prev) =>
                                        prev.filter((x) => x.id !== r.id),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not archive item.",
                                      );
                                    } finally {
                                      setPersonalActionId(null);
                                    }
                                  }}
                                >
                                  Archive
                                </button>
                                <button
                                  type="button"
                                  disabled={personalActionId === r.id}
                                  style={archiveDeleteBtn}
                                  onClick={async () => {
                                    if (!confirm("Delete this focus item?")) return;
                                    setPersonalActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      await deleteDevelopmentFocusItem(r.id);
                                      setPersonalItems((prev) =>
                                        prev.filter((x) => x.id !== r.id),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not delete item.",
                                      );
                                    } finally {
                                      setPersonalActionId(null);
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              </div>

                              <div
                                style={{
                                  borderTop: `1px solid ${borderSubtle}`,
                                  marginTop: 2,
                                  paddingTop: 8,
                                  display: "grid",
                                  gap: 0,
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedPersonalItemId((prev) =>
                                      prev === r.id ? null : r.id,
                                    );
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    width: "100%",
                                    margin: 0,
                                    padding: "2px 0 8px",
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: mutedColor,
                                    textAlign: "left",
                                  }}
                                >
                                  <span>
                                    {updatesOpen
                                      ? "Hide progress updates"
                                      : `Progress updates (${updates.length})`}
                                  </span>
                                </button>

                                {updatesOpen ? (
                                  <div
                                    style={{
                                      display: "grid",
                                      gap: 10,
                                    }}
                                  >
                                    <div
                                      style={{
                                        padding: "10px 12px",
                                        borderRadius: 10,
                                        border: `1px solid ${borderSubtle}`,
                                        backgroundColor: surfaceHover,
                                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                                      }}
                                    >
                                      {updates.length === 0 ? (
                                        <p
                                          style={{
                                            margin: 0,
                                            fontSize: 13,
                                            color: mutedColor,
                                            lineHeight: 1.5,
                                          }}
                                        >
                                          No updates yet.
                                        </p>
                                      ) : (
                                        <ul
                                          style={{
                                            margin: 0,
                                            paddingLeft: 18,
                                            display: "grid",
                                            gap: 10,
                                          }}
                                        >
                                          {updates.map((u) => (
                                            <li
                                              key={u.id}
                                              style={{
                                                listStyleType: "disc",
                                                color: mutedColor,
                                              }}
                                            >
                                              <div
                                                style={{
                                                  display: "grid",
                                                  gap: 4,
                                                }}
                                              >
                                                <span
                                                  style={{
                                                    fontSize: 11,
                                                    color: mutedColor,
                                                    letterSpacing: "0.02em",
                                                  }}
                                                >
                                                  {formatShortDate(u.created_at)}
                                                </span>
                                                <span
                                                  style={{
                                                    fontSize: 13,
                                                    color: text,
                                                    lineHeight: 1.55,
                                                  }}
                                                >
                                                  {u.note}
                                                </span>
                                              </div>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>

                                    <div style={{ display: "grid", gap: 8 }}>
                                      <textarea
                                        rows={2}
                                        value={updateDraftByItemId[r.id] ?? ""}
                                        onChange={(e) =>
                                          setUpdateDraftByItemId((prev) => ({
                                            ...prev,
                                            [r.id]: e.target.value,
                                          }))
                                        }
                                        placeholder="Add a progress note or blocker update…"
                                        style={{
                                          width: "100%",
                                          padding: "10px 12px",
                                          fontSize: 13,
                                          color: text,
                                          backgroundColor: bg,
                                          border: `1px solid ${border}`,
                                          borderRadius: 8,
                                          boxSizing: "border-box" as const,
                                          resize: "vertical" as const,
                                          fontFamily: "inherit",
                                          lineHeight: 1.5,
                                        }}
                                      />
                                      <button
                                        type="button"
                                        disabled={personalActionId === r.id}
                                        style={{
                                          ...btnGhost,
                                          fontSize: 12,
                                          padding: "7px 12px",
                                          justifySelf: "start",
                                        }}
                                        onClick={async () => {
                                          const note = (
                                            updateDraftByItemId[r.id] ?? ""
                                          ).trim();
                                          if (!note) return;
                                          setPersonalActionId(r.id);
                                          setLoadError(null);
                                          try {
                                            const row = await addUpdateForFocusItem({
                                              focus_item_id: r.id,
                                              note,
                                            });
                                            setUpdatesByItemId((prev) => ({
                                              ...prev,
                                              [r.id]: [row, ...(prev[r.id] ?? [])],
                                            }));
                                            setUpdateDraftByItemId((prev) => ({
                                              ...prev,
                                              [r.id]: "",
                                            }));
                                          } catch (err) {
                                            setLoadError(
                                              err instanceof Error
                                                ? err.message
                                                : "Could not add update.",
                                            );
                                          } finally {
                                            setPersonalActionId(null);
                                          }
                                        }}
                                      >
                                        Add update
                                      </button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </section>
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

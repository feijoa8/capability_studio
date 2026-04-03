import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  computeConfidence,
  confidenceTierColor,
  gapTriLabel,
  gapTriState,
  levelOrder,
  normalizeAssessmentRows,
  normalizeJobRequirementRows,
  normalizeOrgUserCompetencyRows,
  relevanceLabel,
  resolveCurrentLevelSource,
  type ConfidenceTier,
  type GapTriState,
  type JobProfileRelevance,
  type LevelDef,
  type OrgUserCompetencyAssessmentRow,
  type OrgUserCompetencyRow,
} from "./hub/competencyComparison";
import { DevelopmentGoalInlineDetail } from "./hub/DevelopmentGoalInlineDetail";
import { normalizeDevelopmentGoal } from "./hub/developmentGoalUtils";
import type { DevelopmentGoalNoteRow, DevelopmentGoalRow } from "./hub/types";
import {
  border,
  gapTriPillStyle,
  muted,
  mutedColor,
  panelShell,
  surface,
  text,
} from "./hub/hubTheme";

export type MyCompetenciesSectionProps = {
  activeOrgId: string | null;
  isActive: boolean;
};

type CompetencyDisplayRow = {
  competency_id: string;
  name: string;
  required_level: string | null;
  current_level_display: string;
  gap_tri: GapTriState;
  relevance: JobProfileRelevance;
  relevance_label: string;
  confidence_label: string;
  confidence_tier: ConfidenceTier;
};

const GOAL_SELECT =
  "id, organisation_id, user_id, competency_id, current_level, target_level, relevance, title, description, suggested_actions, status, progress, created_at, updated_at, lifecycle_status, career_focus_source_id, competencies ( name )";

const gapSortOrder: Record<GapTriState, number> = {
  below: 0,
  meets: 1,
  above: 2,
  unassessed: 3,
};

const relevanceSortOrder: Record<JobProfileRelevance, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function sortCompetencyRows(rows: CompetencyDisplayRow[]): CompetencyDisplayRow[] {
  return [...rows].sort((a, b) => {
    const g = gapSortOrder[a.gap_tri] - gapSortOrder[b.gap_tri];
    if (g !== 0) return g;
    const r =
      relevanceSortOrder[b.relevance] - relevanceSortOrder[a.relevance];
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });
}

export function MyCompetenciesSection({
  activeOrgId,
  isActive,
}: MyCompetenciesSectionProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noJobProfile, setNoJobProfile] = useState(false);
  const [rows, setRows] = useState<CompetencyDisplayRow[]>([]);
  const [goalsByCompetencyId, setGoalsByCompetencyId] = useState<
    Record<string, DevelopmentGoalRow>
  >({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [progressDraft, setProgressDraft] = useState<Record<string, number>>(
    {}
  );
  const [goalNoteDraft, setGoalNoteDraft] = useState<Record<string, string>>(
    {}
  );
  const [goalActionLoading, setGoalActionLoading] = useState<string | null>(
    null
  );
  const [notesByGoalId, setNotesByGoalId] = useState<
    Record<string, DevelopmentGoalNoteRow[]>
  >({});

  const sortedRows = useMemo(() => sortCompetencyRows(rows), [rows]);

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
    const rowsNotes = (data ?? []) as DevelopmentGoalNoteRow[];
    setNotesByGoalId((prev) => ({ ...prev, [goalId]: rowsNotes }));
  }, []);

  useEffect(() => {
    if (!expandedGoalId) return;
    void loadNotesForGoal(expandedGoalId);
  }, [expandedGoalId, loadNotesForGoal]);

  const refreshGoals = useCallback(async () => {
    if (!activeOrgId || !currentUserId) return;
    const { data, error } = await supabase
      .from("development_goals")
      .select(GOAL_SELECT)
      .eq("organisation_id", activeOrgId)
      .eq("user_id", currentUserId)
      .eq("lifecycle_status", "active")
      .in("status", ["not_started", "in_progress"]);

    if (error) {
      console.warn(error.message);
      return;
    }
    const map: Record<string, DevelopmentGoalRow> = {};
    for (const raw of data ?? []) {
      const g = normalizeDevelopmentGoal(raw);
      if (!g.competency_id) continue;
      if (!map[g.competency_id]) {
        map[g.competency_id] = g;
      }
    }
    setGoalsByCompetencyId(map);
  }, [activeOrgId, currentUserId]);

  const handleSaveProgressWithNote = useCallback(
    async (goalId: string, progress: number, noteText: string) => {
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
      await refreshGoals();
      await loadNotesForGoal(goalId);
      if (p >= 100) {
        setExpandedGoalId(null);
      }
    },
    [activeOrgId, currentUserId, refreshGoals, loadNotesForGoal]
  );

  const handleMarkComplete = useCallback(
    async (goalId: string) => {
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
      await refreshGoals();
    },
    [activeOrgId, currentUserId, refreshGoals]
  );

  const loadData = useCallback(async () => {
    if (!activeOrgId || !isActive) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setNoJobProfile(false);
    setRows([]);
    setGoalsByCompetencyId({});
    setExpandedGoalId(null);
    setProgressDraft({});
    setGoalNoteDraft({});
    setNotesByGoalId({});

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setLoadError("Not signed in.");
      setLoading(false);
      return;
    }
    setCurrentUserId(uid);

    const [ujpRes, ucRes, assessRes, goalsRes] = await Promise.all([
      supabase
        .from("user_job_profiles")
        .select("job_profile_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .maybeSingle(),
      supabase
        .from("org_user_competencies")
        .select(
          "id, competency_id, current_level, assessment_source, updated_at, last_updated_by, competencies ( id, name )"
        )
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid),
      supabase
        .from("org_user_competency_assessments")
        .select(
          "id, competency_id, contributor_type, contributor_user_id, assessed_level, created_at, competencies ( id, name )"
        )
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("development_goals")
        .select(GOAL_SELECT)
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .eq("lifecycle_status", "active")
        .in("status", ["not_started", "in_progress"]),
    ]);

    const ucData: OrgUserCompetencyRow[] = ucRes.error
      ? []
      : normalizeOrgUserCompetencyRows(ucRes.data);
    if (ucRes.error) {
      setLoadError(ucRes.error.message);
      setLoading(false);
      return;
    }

    const assessData: OrgUserCompetencyAssessmentRow[] = assessRes.error
      ? []
      : normalizeAssessmentRows(assessRes.data);
    if (assessRes.error) {
      console.error(assessRes.error);
    }

    const goalMap: Record<string, DevelopmentGoalRow> = {};
    if (!goalsRes.error && goalsRes.data) {
      for (const raw of goalsRes.data) {
        const g = normalizeDevelopmentGoal(raw);
        if (!g.competency_id) continue;
        if (!goalMap[g.competency_id]) {
          goalMap[g.competency_id] = g;
        }
      }
    } else if (goalsRes.error) {
      console.warn("development_goals:", goalsRes.error.message);
    }
    setGoalsByCompetencyId(goalMap);

    let jobId: string | null = null;
    if (ujpRes.error) {
      console.error(ujpRes.error);
    } else {
      jobId =
        (ujpRes.data as { job_profile_id: string | null } | null)
          ?.job_profile_id ?? null;
    }

    if (!jobId) {
      setNoJobProfile(true);
      setLoading(false);
      return;
    }

    const reqRes = await supabase
      .from("job_profile_competencies")
      .select(
        "competency_id, required_level, is_required, relevance, competencies ( id, name )"
      )
      .eq("job_profile_id", jobId);

    if (reqRes.error) {
      setLoadError(reqRes.error.message);
      setLoading(false);
      return;
    }

    const reqRows = normalizeJobRequirementRows(reqRes.data);
    const compIds = new Set<string>();
    for (const r of reqRows) compIds.add(r.competency_id);
    for (const u of ucData) compIds.add(u.competency_id);
    for (const a of assessData) compIds.add(a.competency_id);

    let levelDefs: LevelDef[] = [];
    if (compIds.size > 0) {
      const ldRes = await supabase
        .from("competency_level_definitions")
        .select("competency_id, level_name, level_order")
        .in("competency_id", [...compIds])
        .eq("is_active", true)
        .order("level_order", { ascending: true });
      if (ldRes.error) {
        console.error(ldRes.error);
      } else {
        levelDefs = (ldRes.data as LevelDef[] | null) ?? [];
      }
    }

    const display: CompetencyDisplayRow[] = reqRows.map((req) => {
      const uc = ucData.find((u) => u.competency_id === req.competency_id);
      const { level: effectiveLevel, isAgreed } = resolveCurrentLevelSource(
        req.competency_id,
        uc,
        assessData
      );
      const hasCurrentLevel = Boolean(effectiveLevel?.length);
      const curOrder = levelOrder(
        req.competency_id,
        hasCurrentLevel ? effectiveLevel : null,
        levelDefs
      );
      const reqOrder = levelOrder(
        req.competency_id,
        req.required_level,
        levelDefs
      );
      const gap_tri = gapTriState(curOrder, reqOrder, hasCurrentLevel);
      const name =
        req.competencies?.name?.trim() ||
        uc?.competency_name?.trim() ||
        "Unknown competency";
      const confidence = computeConfidence(
        req.competency_id,
        isAgreed,
        assessData
      );
      const current_level_display = hasCurrentLevel
        ? effectiveLevel!
        : "Not assessed";

      return {
        competency_id: req.competency_id,
        name,
        required_level: req.required_level,
        current_level_display,
        gap_tri,
        relevance: req.relevance,
        relevance_label: relevanceLabel(req.relevance),
        confidence_label: confidence.label,
        confidence_tier: confidence.tier,
      };
    });

    setRows(display);
    setLoading(false);
  }, [activeOrgId, isActive]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!isActive) {
    return null;
  }

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to see your role competencies.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading competencies…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ margin: 0, fontSize: 14, color: "#e87878" }}>{loadError}</p>
      </div>
    );
  }

  const card = {
    padding: "14px 16px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ marginBottom: 20 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: text,
            letterSpacing: "-0.02em",
          }}
        >
          My Competencies
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          Track your current capability against your role expectations.
        </p>
      </header>

      {noJobProfile ? (
        <div style={{ ...panelShell, marginTop: 0 }}>
          <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
            No job profile is assigned to you in this workspace yet. When an
            administrator assigns a role, your competency expectations will
            appear here.
          </p>
        </div>
      ) : sortedRows.length === 0 ? (
        <div style={{ ...panelShell, marginTop: 0 }}>
          <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
            Your job profile has no competency expectations defined yet.
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
          {sortedRows.map((row) => {
            const goal = goalsByCompetencyId[row.competency_id];
            const expanded = goal ? expandedGoalId === goal.id : false;
            const prog =
              goal && progressDraft[goal.id] !== undefined
                ? progressDraft[goal.id]
                : goal?.progress ?? 0;

            return (
              <li key={row.competency_id} style={{ ...card, margin: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: text,
                    marginBottom: 10,
                  }}
                >
                  {row.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      padding: "5px 10px",
                      borderRadius: 6,
                      ...gapTriPillStyle(row.gap_tri),
                    }}
                  >
                    {gapTriLabel(row.gap_tri)}
                  </span>
                  <span style={{ fontSize: 13, color: mutedColor }}>
                    Relevance:{" "}
                    <span style={{ color: text, fontWeight: 500 }}>
                      {row.relevance_label}
                    </span>
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: mutedColor,
                    display: "grid",
                    gap: 4,
                    lineHeight: 1.45,
                  }}
                >
                  <div>
                    Required:{" "}
                    <span style={{ color: text }}>
                      {row.required_level?.trim() || "—"}
                    </span>
                  </div>
                  <div>
                    Current:{" "}
                    <span style={{ color: text }}>
                      {row.current_level_display}
                    </span>
                  </div>
                  <div>
                    Confidence:{" "}
                    <span
                      style={{
                        color: confidenceTierColor(row.confidence_tier),
                        fontWeight: 600,
                      }}
                    >
                      {row.confidence_tier}
                    </span>
                    <span style={{ color: mutedColor, fontWeight: 400 }}>
                      {" "}
                      · {row.confidence_label}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${border}`,
                  }}
                >
                  {goal ? (
                    <DevelopmentGoalInlineDetail
                      goal={goal}
                      variant="compact"
                      expanded={expanded}
                      onToggleExpand={() => {
                        if (expandedGoalId === goal.id) {
                          setExpandedGoalId(null);
                        } else {
                          setExpandedGoalId(goal.id);
                          setProgressDraft((d) => ({
                            ...d,
                            [goal.id]: goal.progress,
                          }));
                          setGoalNoteDraft((d) => ({ ...d, [goal.id]: "" }));
                        }
                      }}
                      progressDraft={prog}
                      onProgressDraftChange={(v) =>
                        setProgressDraft((d) => ({ ...d, [goal.id]: v }))
                      }
                      goalNoteDraft={goalNoteDraft[goal.id] ?? ""}
                      onGoalNoteDraftChange={(v) =>
                        setGoalNoteDraft((d) => ({ ...d, [goal.id]: v }))
                      }
                      notes={notesByGoalId[goal.id] ?? []}
                      onSaveProgress={() =>
                        void handleSaveProgressWithNote(
                          goal.id,
                          prog,
                          goalNoteDraft[goal.id] ?? ""
                        )
                      }
                      onMarkComplete={() => void handleMarkComplete(goal.id)}
                      actionLoading={goalActionLoading === goal.id}
                    />
                  ) : (
                    <span style={{ fontSize: 12, color: mutedColor }}>
                      No active development goal for this competency.
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

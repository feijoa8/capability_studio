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
import {
  aggregateIndustriesFromEvidence,
  aggregateMethodsFromEvidence,
  aggregateSkillsFromEvidence,
  aggregateToolsFromEvidence,
  PERSONAL_EVIDENCE_SKILL_TOP_N,
} from "./hub/personalEvidenceDerivation";
import type {
  DevelopmentGoalNoteRow,
  DevelopmentGoalRow,
  UserExperienceProject,
  UserExperienceRow,
} from "./hub/types";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  btnPrimary,
  gapTriPillStyle,
  muted,
  mutedColor,
  panelShell,
  sectionEyebrow,
  surface,
  text,
} from "./hub/hubTheme";

export type MyCompetenciesSectionProps = {
  activeOrgId: string | null;
  isActive: boolean;
  primaryAccountType: string | null;
  primaryAccountTypeReady: boolean;
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
  subject_id: string | null;
  subject_name: string | null;
  subject_type: string | null;
  practice_name: string | null;
  competency_type: string | null;
  isStretch: boolean;
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

function formatSubjectMetaLine(row: CompetencyDisplayRow): string | null {
  const parts: string[] = [];
  if (row.practice_name?.trim()) parts.push(row.practice_name.trim());
  if (row.subject_type) {
    const t = row.subject_type.toLowerCase();
    if (t === "practice") parts.push("Practice");
    else if (t === "organisation") parts.push("Organisation-wide");
    else if (t === "stretch") parts.push("Stretch");
    else parts.push(row.subject_type);
  }
  return parts.length ? parts.join(" · ") : null;
}

type SubjectGroup = {
  key: string;
  heading: string;
  meta: string | null;
  rows: CompetencyDisplayRow[];
};

type ListFilter = "all" | "unassessed" | "high_gap" | "high_relevance";

/**
 * Wide list columns: Competency, Required, Current, Gap, Evidence, Actions
 * — tuned for desktop; wraps gracefully on small viewports via minmax.
 */
const COMP_ROW_GRID =
  "minmax(160px, 2.1fr) minmax(64px, 0.42fr) minmax(72px, 0.48fr) minmax(88px, 0.42fr) minmax(100px, 0.95fr) minmax(200px, 1.05fr)";

function groupCompetenciesBySubject(
  rows: CompetencyDisplayRow[],
): SubjectGroup[] {
  const map = new Map<
    string,
    { heading: string; meta: string | null; rows: CompetencyDisplayRow[] }
  >();
  for (const row of rows) {
    const key = row.subject_id ?? "__none__";
    if (!map.has(key)) {
      const heading = row.subject_name?.trim() || "No subject linked";
      const meta = formatSubjectMetaLine(row);
      map.set(key, { heading, meta, rows: [] });
    }
    map.get(key)!.rows.push(row);
  }
  for (const g of map.values()) {
    g.rows = sortCompetencyRows(g.rows);
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (a === "__none__") return 1;
    if (b === "__none__") return -1;
    return map.get(a)!.heading.localeCompare(map.get(b)!.heading, undefined, {
      sensitivity: "base",
    });
  });
  return keys.map((k) => ({
    key: k,
    heading: map.get(k)!.heading,
    meta: map.get(k)!.meta,
    rows: map.get(k)!.rows,
  }));
}

export function MyCompetenciesSection({
  activeOrgId,
  isActive,
  primaryAccountType,
  primaryAccountTypeReady,
}: MyCompetenciesSectionProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Personal Account with no workspace — role grid is N/A; show personal empty state. */
  const [personalStandaloneNoOrg, setPersonalStandaloneNoOrg] =
    useState(false);
  const [noJobProfile, setNoJobProfile] = useState(false);
  const [rows, setRows] = useState<CompetencyDisplayRow[]>([]);
  const [goalsByCompetencyId, setGoalsByCompetencyId] = useState<
    Record<string, DevelopmentGoalRow>
  >({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  /** Personal Account: evidence-tag summaries from saved roles + projects. */
  const [personalSkillSummary, setPersonalSkillSummary] = useState<
    { label: string; count: number }[]
  >([]);
  const [personalMethodSummary, setPersonalMethodSummary] = useState<
    { label: string; count: number }[]
  >([]);
  const [personalToolSummary, setPersonalToolSummary] = useState<
    { label: string; count: number }[]
  >([]);
  const [personalIndustrySummary, setPersonalIndustrySummary] = useState<
    { label: string; count: number }[]
  >([]);

  const [expandedDetailCompetencyId, setExpandedDetailCompetencyId] = useState<
    string | null
  >(null);
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
  const hasStretchInProfile = useMemo(
    () => rows.some((r) => r.isStretch),
    [rows],
  );

  const [listSearch, setListSearch] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  /** Subject group collapse: omitted key = expanded */
  const [subjectOpen, setSubjectOpen] = useState<Record<string, boolean>>({});

  const filteredSortedRows = useMemo(() => {
    let r = sortedRows;
    const q = listSearch.trim().toLowerCase();
    if (q) {
      r = r.filter((row) => {
        const name = row.name.toLowerCase();
        const sub = (row.subject_name ?? "").toLowerCase();
        return name.includes(q) || sub.includes(q);
      });
    }
    if (listFilter === "unassessed") {
      r = r.filter((row) => row.gap_tri === "unassessed");
    } else if (listFilter === "high_gap") {
      r = r.filter((row) => row.gap_tri === "below");
    } else if (listFilter === "high_relevance") {
      r = r.filter((row) => row.relevance === "high");
    }
    return r;
  }, [sortedRows, listSearch, listFilter]);

  const roleAlignedRows = useMemo(
    () => filteredSortedRows.filter((r) => !r.isStretch),
    [filteredSortedRows],
  );
  const stretchRows = useMemo(
    () => filteredSortedRows.filter((r) => r.isStretch),
    [filteredSortedRows],
  );
  const roleSubjectGroups = useMemo(
    () => groupCompetenciesBySubject(roleAlignedRows),
    [roleAlignedRows],
  );
  const stretchSubjectGroups = useMemo(
    () => groupCompetenciesBySubject(stretchRows),
    [stretchRows],
  );

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
    if (!expandedDetailCompetencyId) return;
    const g = goalsByCompetencyId[expandedDetailCompetencyId];
    if (!g) return;
    void loadNotesForGoal(g.id);
  }, [expandedDetailCompetencyId, goalsByCompetencyId, loadNotesForGoal]);

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
        setExpandedDetailCompetencyId(null);
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
      setExpandedDetailCompetencyId(null);
      await refreshGoals();
    },
    [activeOrgId, currentUserId, refreshGoals]
  );

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
      setNoJobProfile(false);
      setRows([]);
      setGoalsByCompetencyId({});
      setProgressDraft({});
      setGoalNoteDraft({});
      setNotesByGoalId({});
      setExpandedDetailCompetencyId(null);
      setPersonalSkillSummary([]);
      setPersonalMethodSummary([]);
      setPersonalToolSummary([]);
      setPersonalIndustrySummary([]);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setLoadError("Not signed in.");
        setPersonalStandaloneNoOrg(false);
        setLoading(false);
        return;
      }
      setCurrentUserId(uid);

      const [expRes, projRes] = await Promise.all([
        supabase
          .from("user_experience")
          .select("*")
          .eq("user_id", uid)
          .order("sort_order", { ascending: true }),
        supabase
          .from("user_experience_projects")
          .select("*")
          .eq("user_id", uid),
      ]);
      if (expRes.error) console.warn(expRes.error.message);
      if (projRes.error) console.warn(projRes.error.message);
      const ex = (expRes.data as UserExperienceRow[]) ?? [];
      const pr = (projRes.data as UserExperienceProject[]) ?? [];
      setPersonalSkillSummary(aggregateSkillsFromEvidence(ex, pr));
      setPersonalMethodSummary(aggregateMethodsFromEvidence(ex, pr));
      setPersonalToolSummary(aggregateToolsFromEvidence(ex, pr));
      setPersonalIndustrySummary(aggregateIndustriesFromEvidence(ex, pr));

      setLoading(false);
      return;
    }

    setPersonalStandaloneNoOrg(false);
    setPersonalSkillSummary([]);
    setPersonalMethodSummary([]);
    setPersonalToolSummary([]);
    setPersonalIndustrySummary([]);

    if (!activeOrgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setNoJobProfile(false);
    setRows([]);
    setGoalsByCompetencyId({});
    setProgressDraft({});
    setGoalNoteDraft({});
    setNotesByGoalId({});
    setExpandedDetailCompetencyId(null);

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
        "competency_id, required_level, is_required, relevance, competencies ( id, name, competency_type, subject_id, competency_subjects ( id, name, type, competency_practices ( name ) ) )"
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

      const isStretch =
        req.competency_type?.toLowerCase() === "stretch" ||
        req.subject_type?.toLowerCase() === "stretch";

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
        subject_id: req.subject_id ?? null,
        subject_name: req.subject_name?.trim() || null,
        subject_type: req.subject_type ?? null,
        practice_name: req.practice_name?.trim() || null,
        competency_type: req.competency_type ?? null,
        isStretch,
      };
    });

    setRows(display);
    setLoading(false);
  }, [activeOrgId, isActive, primaryAccountType]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!isActive) {
    return null;
  }

  if (!activeOrgId && !primaryAccountTypeReady) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading competencies…</p>
      </div>
    );
  }

  if (!activeOrgId && primaryAccountType !== "personal") {
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

  /** Sticky offset for subject bars — sits below the column header row (~40px). */
  const STICKY_SUBJECT_TOP = 42;

  const card = {
    padding: "0",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
    /** Allow position:sticky on header rows (overflow:hidden breaks sticky). */
    overflow: "visible" as const,
  };

  const renderColumnHeader = (sticky: boolean) => (
    <div
      role="row"
      style={{
        display: "grid",
        gridTemplateColumns: COMP_ROW_GRID,
        gap: 12,
        alignItems: "center",
        padding: "10px 18px",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color: mutedColor,
        borderBottom: `1px solid ${border}`,
        backgroundColor: bg,
        ...(sticky
          ? {
              position: "sticky" as const,
              top: 0,
              zIndex: 6,
              boxShadow: "0 1px 0 rgba(0,0,0,0.35)",
            }
          : {}),
      }}
    >
      <span>Competency</span>
      <span style={{ textAlign: "right" }}>Required</span>
      <span style={{ textAlign: "right" }}>Current</span>
      <span style={{ textAlign: "right" }}>Gap</span>
      <span>Evidence</span>
      <span style={{ textAlign: "right" }}>Actions</span>
    </div>
  );

  const renderCompetencyRow = (row: CompetencyDisplayRow) => {
    const goal = goalsByCompetencyId[row.competency_id];
    const detailOpen = expandedDetailCompetencyId === row.competency_id;
    const prog =
      goal && progressDraft[goal.id] !== undefined
        ? progressDraft[goal.id]
        : goal?.progress ?? 0;

    const openDetail = () => {
      if (detailOpen) {
        setExpandedDetailCompetencyId(null);
      } else {
        setExpandedDetailCompetencyId(row.competency_id);
        if (goal) {
          setProgressDraft((d) => ({ ...d, [goal.id]: goal.progress }));
          setGoalNoteDraft((d) => ({ ...d, [goal.id]: "" }));
        }
      }
    };

    return (
      <div key={row.competency_id}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: COMP_ROW_GRID,
            gap: 12,
            alignItems: "start",
            padding: "12px 18px",
            fontSize: 13,
            borderBottom: `1px solid ${borderSubtle}`,
            backgroundColor: surface,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                color: text,
                lineHeight: 1.35,
              }}
            >
              {row.name}
            </div>
            <div style={{ fontSize: 13, color: mutedColor, marginTop: 2 }}>
              Relevance:{" "}
              <span style={{ color: text, fontWeight: 500 }}>
                {row.relevance_label}
              </span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              color: text,
              fontSize: 12,
            }}
            title="Required"
          >
            {row.required_level?.trim() || "—"}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              color: text,
              fontSize: 12,
            }}
            title="Current"
          >
            {row.current_level_display}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "4px 8px",
                borderRadius: 6,
                ...gapTriPillStyle(row.gap_tri),
              }}
            >
              {gapTriLabel(row.gap_tri)}
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: confidenceTierColor(row.confidence_tier),
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {row.confidence_tier}
            </div>
            <div style={{ fontSize: 11, color: mutedColor, lineHeight: 1.35 }}>
              {row.confidence_label}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={openDetail}
              style={{ ...btnGhost, fontSize: 11, padding: "5px 10px" }}
            >
              {detailOpen ? "Hide" : "Details"}
            </button>
            <button
              type="button"
              onClick={() =>
                alert(
                  "Self-assessment updates will be available here in a future release.",
                )
              }
              style={{ ...btnGhost, fontSize: 11, padding: "5px 10px" }}
            >
              Update score
            </button>
            <button
              type="button"
              disabled
              title="360 feedback — coming soon"
              style={{
                ...btnGhost,
                fontSize: 11,
                padding: "5px 10px",
                opacity: 0.45,
                cursor: "not-allowed",
              }}
            >
              Feedback
            </button>
          </div>
        </div>
        {detailOpen ? (
          <div
            style={{
              padding: "0 18px 14px 18px",
              backgroundColor: bg,
              borderBottom: `1px solid ${borderSubtle}`,
            }}
          >
            {goal ? (
              <DevelopmentGoalInlineDetail
                goal={goal}
                variant="compact"
                expanded={true}
                onToggleExpand={() => setExpandedDetailCompetencyId(null)}
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
                    goalNoteDraft[goal.id] ?? "",
                  )
                }
                onMarkComplete={() => void handleMarkComplete(goal.id)}
                actionLoading={goalActionLoading === goal.id}
              />
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
                No active development goal for this competency. Development
                goals you add here will appear when that feature is connected to
                this view.
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  function subjectSectionKey(section: "role" | "stretch", key: string) {
    return `${section}::${key}`;
  }

  const renderSubjectGroup = (
    g: SubjectGroup,
    section: "role" | "stretch",
    stickySubject: boolean,
  ) => {
    const tKey = subjectSectionKey(section, g.key);
    const expanded = subjectOpen[tKey] !== false;
    return (
      <div key={tKey}>
        <button
          type="button"
          onClick={() =>
            setSubjectOpen((prev) => {
              const isOpen = prev[tKey] !== false;
              return { ...prev, [tKey]: !isOpen };
            })
          }
          style={{
            width: "100%",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            textAlign: "left",
            cursor: "pointer",
            padding: "10px 18px",
            margin: 0,
            font: "inherit",
            border: "none",
            borderBottom: `1px solid ${borderSubtle}`,
            backgroundColor: "rgba(255,255,255,0.03)",
            borderLeft: `3px solid rgba(110, 176, 240, 0.45)`,
            ...(stickySubject
              ? {
                  position: "sticky" as const,
                  top: STICKY_SUBJECT_TOP,
                  zIndex: 4,
                }
              : {}),
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 650,
                color: text,
                letterSpacing: "-0.01em",
              }}
            >
              {g.heading}
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 500,
                  color: mutedColor,
                }}
              >
                ({g.rows.length})
              </span>
            </div>
            {g.meta ? (
              <div style={{ fontSize: 11, color: mutedColor, marginTop: 4 }}>
                {g.meta}
              </div>
            ) : null}
          </div>
          <span
            aria-hidden
            style={{
              flexShrink: 0,
              fontSize: 12,
              color: mutedColor,
              marginTop: 2,
            }}
          >
            {expanded ? "▾" : "▸"}
          </span>
        </button>
        {expanded ? g.rows.map((row) => renderCompetencyRow(row)) : null}
      </div>
    );
  };

  const filterPill = (id: ListFilter, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setListFilter(id)}
      style={{
        ...(listFilter === id ? btnPrimary : btn),
        fontSize: 12,
        padding: "6px 12px",
        borderRadius: 999,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      <header style={{ marginBottom: 18, maxWidth: 920 }}>
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
          {personalStandaloneNoOrg
            ? "Personal Account: see skills and industries derived from your saved experience. Organisation job-profile competencies appear when you join or select a workspace."
            : "A read-first view of your capability against your role. Self-updates and 360 input will expand here over time."}
        </p>
      </header>

      {personalStandaloneNoOrg ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            ...panelShell,
            marginTop: 0,
            padding: "16px 18px",
            borderRadius: 10,
            borderStyle: "dashed",
            borderColor: borderSubtle,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: text,
              lineHeight: 1.45,
            }}
          >
            Personal Account
          </p>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 14,
              color: mutedColor,
              lineHeight: 1.55,
            }}
          >
            Role-based competency expectations are tied to a job profile in an
            organisation workspace. This area will become more useful as you
            complete your profile and add experience; workspace-specific
            expectations appear when you join or select a workspace.
          </p>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 14,
              color: mutedColor,
              lineHeight: 1.55,
            }}
          >
            You are not missing a step — a Personal Account does not require a
            workspace to use your personal areas.
          </p>
        </div>

        <div
          style={{
            ...panelShell,
            marginTop: 0,
            padding: "16px 18px",
            borderRadius: 10,
            border: `1px solid ${borderSubtle}`,
            backgroundColor: surface,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: mutedColor,
            }}
          >
            From your experience
          </p>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13,
              color: mutedColor,
              lineHeight: 1.5,
            }}
          >
            Skills, methods, tools, and industry context are aggregated from
            evidence on your work roles and projects in{" "}
            <strong style={{ color: text }}>My Experience</strong> (including CV
            import). They are read-only here — edit the underlying entries to
            change them.
          </p>
          {personalSkillSummary.length === 0 &&
          personalMethodSummary.length === 0 &&
          personalToolSummary.length === 0 &&
          personalIndustrySummary.length === 0 ? (
            <p
              style={{
                margin: "12px 0 0",
                fontSize: 14,
                color: mutedColor,
                lineHeight: 1.5,
              }}
            >
              No skills or industries yet. Add roles or import a CV under My
              Experience to populate this summary.
            </p>
          ) : (
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gap: 18,
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  Skills (top {PERSONAL_EVIDENCE_SKILL_TOP_N})
                </p>
                {personalSkillSummary.length === 0 ? (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 13,
                      color: mutedColor,
                    }}
                  >
                    None tagged yet.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: "8px 0 0",
                      padding: "0 0 0 18px",
                      fontSize: 13,
                      color: text,
                      lineHeight: 1.55,
                    }}
                  >
                    {personalSkillSummary
                      .slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N)
                      .map((s) => (
                        <li key={s.label}>
                          {s.label}{" "}
                          <span style={{ color: mutedColor }}>
                            ({s.count}{" "}
                            {s.count === 1 ? "mention" : "mentions"})
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  Methods / practices
                </p>
                {personalMethodSummary.length === 0 ? (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 13,
                      color: mutedColor,
                    }}
                  >
                    None yet.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: "8px 0 0",
                      padding: "0 0 0 18px",
                      fontSize: 13,
                      color: text,
                      lineHeight: 1.55,
                    }}
                  >
                    {personalMethodSummary
                      .slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N)
                      .map((s) => (
                        <li key={s.label}>
                          {s.label}{" "}
                          <span style={{ color: mutedColor }}>
                            ({s.count}{" "}
                            {s.count === 1 ? "mention" : "mentions"})
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  Tools / platforms
                </p>
                {personalToolSummary.length === 0 ? (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 13,
                      color: mutedColor,
                    }}
                  >
                    None yet.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: "8px 0 0",
                      padding: "0 0 0 18px",
                      fontSize: 13,
                      color: text,
                      lineHeight: 1.55,
                    }}
                  >
                    {personalToolSummary
                      .slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N)
                      .map((s) => (
                        <li key={s.label}>
                          {s.label}{" "}
                          <span style={{ color: mutedColor }}>
                            ({s.count}{" "}
                            {s.count === 1 ? "mention" : "mentions"})
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  Industries
                </p>
                {personalIndustrySummary.length === 0 ? (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 13,
                      color: mutedColor,
                    }}
                  >
                    None labeled yet.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: "8px 0 0",
                      padding: "0 0 0 18px",
                      fontSize: 13,
                      color: text,
                      lineHeight: 1.55,
                    }}
                  >
                    {personalIndustrySummary.slice(0, 20).map((s) => (
                      <li key={s.label}>
                        {s.label}{" "}
                        <span style={{ color: mutedColor }}>
                          ({s.count}{" "}
                          {s.count === 1 ? "entry" : "entries"})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      ) : noJobProfile ? (
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
      ) : filteredSortedRows.length === 0 ? (
        <div style={{ ...panelShell, marginTop: 0 }}>
          <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
            No competencies match your search or filter. Clear the query or set
            the filter to &quot;All&quot; to see everything again.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${borderSubtle}`,
              backgroundColor: "rgba(255,255,255,0.02)",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: mutedColor,
                flex: "1 1 200px",
                minWidth: 0,
              }}
            >
              <span style={{ flexShrink: 0 }}>Search</span>
              <input
                type="search"
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Name or subject…"
                autoComplete="off"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "8px 12px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              />
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, color: mutedColor, marginRight: 4 }}>
                Show
              </span>
              {filterPill("all", "All")}
              {filterPill("unassessed", "Unassessed")}
              {filterPill("high_gap", "High gap")}
              {filterPill("high_relevance", "High relevance")}
            </div>
          </div>

          <section>
            <p style={{ ...sectionEyebrow, marginTop: 0 }}>Role expectations</p>
            <p style={{ margin: "4px 0 12px", fontSize: 12, color: mutedColor }}>
              Competencies from your assigned job profile, grouped by subject.
              Use the row headers to collapse a subject.
            </p>
            <div
              style={{
                width: "100%",
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
              }}
            >
            <div style={{ ...card, minWidth: "min(100%, 960px)" }}>
              {renderColumnHeader(true)}
              {roleSubjectGroups.length === 0 ? (
                <p
                  style={{
                    margin: 0,
                    padding: "16px 18px",
                    fontSize: 13,
                    color: mutedColor,
                  }}
                >
                  No role-aligned competencies match the current filter (or all
                  are classified as stretch).
                </p>
              ) : (
                roleSubjectGroups.map((g) =>
                  renderSubjectGroup(g, "role", true),
                )
              )}
            </div>
            </div>
          </section>

          <section>
            <p style={{ ...sectionEyebrow, marginTop: 0 }}>
              Development &amp; stretch
            </p>
            <p style={{ margin: "4px 0 12px", fontSize: 12, color: mutedColor }}>
              Stretch and development-focused competencies — shown separately
              from core role expectations.
            </p>
            <div
              style={{
                width: "100%",
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
              }}
            >
            <div
              style={{
                ...card,
                borderColor: borderSubtle,
                backgroundColor: bg,
                minWidth: "min(100%, 960px)",
              }}
            >
              {stretchSubjectGroups.length === 0 ? (
                <p
                  style={{
                    margin: 0,
                    padding: "16px 18px",
                    fontSize: 13,
                    color: mutedColor,
                    lineHeight: 1.5,
                  }}
                >
                  {!hasStretchInProfile
                    ? "No stretch or development competencies are linked to your profile yet. When your organisation assigns stretch expectations, they will appear here."
                    : "No stretch competencies match the current filter."}
                </p>
              ) : (
                <>
                  {renderColumnHeader(true)}
                  {stretchSubjectGroups.map((g) =>
                    renderSubjectGroup(g, "stretch", true),
                  )}
                </>
              )}
            </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

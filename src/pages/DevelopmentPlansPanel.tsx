/* eslint-disable react-hooks/set-state-in-effect -- Supabase-backed plan/objective loads (matches hub patterns) */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type {
  DevelopmentPlanObjectiveNoteRow,
  DevelopmentPlanObjectiveNoteType,
  DevelopmentPlanObjectiveRow,
  DevelopmentPlanRow,
  DevelopmentPlanStatus,
  DevelopmentPlanType,
} from "./hub/types";
import {
  accentMuted,
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  errorColor,
  mutedColor,
  surface,
  text,
} from "./hub/hubTheme";
import { pickPrimaryPlanForReview } from "./hub/developmentPlanPick";
import { fetchMyManagerId } from "./hub/reportingLines";

type Props = {
  activeOrgId: string;
  currentUserId: string;
  /** When set, load and show this user's plans (manager view of a direct report). */
  subjectUserId?: string | null;
  /** Display name for copy when `subjectUserId` is set (manager view). */
  subjectDisplayName?: string | null;
  /**
   * When viewing a subject's plans, only the direct manager may approve plans and
   * add manager comments. Pass false (or omit) for read-only manager-style views.
   */
  canManageDirectReport?: boolean;
  /** Called after plans are (re)loaded from the server (e.g. parent can refresh team summaries). */
  onPlansChanged?: () => void;
};

/** Minimal row for backlog goals (lifecycle backlog) when adding to a plan */
type BacklogGoalRow = {
  id: string;
  title: string;
  description: string | null;
  competency_id: string | null;
  career_focus_source_id: string | null;
};

function parseBacklogGoal(raw: unknown): BacklogGoalRow {
  const r = raw as Record<string, unknown>;
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    description:
      r.description === null || r.description === undefined
        ? null
        : String(r.description),
    competency_id:
      r.competency_id === null || r.competency_id === undefined
        ? null
        : String(r.competency_id),
    career_focus_source_id:
      r.career_focus_source_id === null ||
      r.career_focus_source_id === undefined
        ? null
        : String(r.career_focus_source_id),
  };
}

function normalizePlan(raw: unknown): DevelopmentPlanRow {
  const r = raw as Record<string, unknown>;
  const pt = r.plan_type;
  const st = r.status;
  return {
    id: String(r.id),
    organisation_id: String(r.organisation_id),
    user_id: String(r.user_id),
    manager_user_id:
      r.manager_user_id === null || r.manager_user_id === undefined
        ? null
        : String(r.manager_user_id),
    title: String(r.title ?? ""),
    description:
      r.description === null || r.description === undefined
        ? null
        : String(r.description),
    plan_type:
      pt === "quarterly" || pt === "custom" || pt === "annual"
        ? pt
        : "annual",
    start_date:
      r.start_date === null || r.start_date === undefined
        ? null
        : String(r.start_date),
    end_date:
      r.end_date === null || r.end_date === undefined
        ? null
        : String(r.end_date),
    status: (() => {
      if (st === "pending_review") return "submitted" as const;
      if (
        st === "draft" ||
        st === "submitted" ||
        st === "active" ||
        st === "completed" ||
        st === "archived"
      ) {
        return st;
      }
      return "draft";
    })(),
    employee_signed_at:
      r.employee_signed_at === null || r.employee_signed_at === undefined
        ? null
        : String(r.employee_signed_at),
    manager_reviewed_at:
      r.manager_reviewed_at === null || r.manager_reviewed_at === undefined
        ? null
        : String(r.manager_reviewed_at),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

function normalizeObjective(raw: unknown): DevelopmentPlanObjectiveRow {
  const r = raw as Record<string, unknown>;
  const pr = r.priority;
  const st = r.status;
  return {
    id: String(r.id),
    development_plan_id: String(r.development_plan_id),
    organisation_id: String(r.organisation_id),
    user_id: String(r.user_id),
    source_goal_id:
      r.source_goal_id === null || r.source_goal_id === undefined
        ? null
        : String(r.source_goal_id),
    competency_id:
      r.competency_id === null || r.competency_id === undefined
        ? null
        : String(r.competency_id),
    title: String(r.title ?? ""),
    description:
      r.description === null || r.description === undefined
        ? null
        : String(r.description),
    success_criteria:
      r.success_criteria === null || r.success_criteria === undefined
        ? null
        : String(r.success_criteria),
    due_date:
      r.due_date === null || r.due_date === undefined
        ? null
        : String(r.due_date),
    priority:
      pr === "low" || pr === "medium" || pr === "high" ? pr : "medium",
    progress: Math.max(0, Math.min(100, Number(r.progress ?? 0))),
    status:
      st === "not_started" ||
      st === "in_progress" ||
      st === "pending_manager_review" ||
      st === "completed" ||
      st === "blocked"
        ? st
        : "not_started",
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

function normalizeObjectiveNote(raw: unknown): DevelopmentPlanObjectiveNoteRow {
  const r = raw as Record<string, unknown>;
  const nt = r.note_type;
  return {
    id: String(r.id),
    development_plan_objective_id: String(r.development_plan_objective_id),
    organisation_id: String(r.organisation_id),
    user_id: String(r.user_id),
    note_type:
      nt === "blocker" ||
      nt === "reflection" ||
      nt === "manager_comment" ||
      nt === "update"
        ? nt
        : "update",
    content: String(r.content ?? ""),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  };
}

function planTypeLabel(t: DevelopmentPlanType): string {
  if (t === "quarterly") return "Quarterly";
  if (t === "custom") return "Custom";
  return "Annual";
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

function planStatusBadgeStyle(s: DevelopmentPlanStatus): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    padding: "5px 10px",
    borderRadius: 6,
    border: `1px solid ${borderSubtle}`,
  };
  switch (s) {
    case "draft":
      return { ...base, color: mutedColor, backgroundColor: bg };
    case "submitted":
      return {
        ...base,
        color: "#c8e0ff",
        backgroundColor: accentMuted,
        borderColor: "rgba(110, 176, 240, 0.35)",
      };
    case "active":
      return {
        ...base,
        color: text,
        backgroundColor: "rgba(120, 200, 140, 0.12)",
        borderColor: "rgba(120, 200, 140, 0.35)",
      };
    case "completed":
      return {
        ...base,
        color: mutedColor,
        backgroundColor: surface,
      };
    case "archived":
      return {
        ...base,
        color: mutedColor,
        backgroundColor: bg,
        opacity: 0.85,
      };
    default:
      return { ...base, color: mutedColor };
  }
}

function noteTypeLabel(t: DevelopmentPlanObjectiveNoteType): string {
  const map: Record<DevelopmentPlanObjectiveNoteType, string> = {
    update: "Update",
    blocker: "Blocker",
    reflection: "Reflection",
    manager_comment: "Manager",
  };
  return map[t] ?? t;
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function objectiveStatusLabel(s: DevelopmentPlanObjectiveRow["status"]): string {
  const map: Record<DevelopmentPlanObjectiveRow["status"], string> = {
    not_started: "Not started",
    in_progress: "In progress",
    pending_manager_review: "Pending manager review",
    completed: "Completed",
    blocked: "Blocked",
  };
  return map[s] ?? s;
}

export function DevelopmentPlansPanel({
  activeOrgId,
  currentUserId,
  subjectUserId = null,
  subjectDisplayName = null,
  canManageDirectReport = false,
  onPlansChanged,
}: Props) {
  const planOwnerId = subjectUserId ?? currentUserId;
  const isManagerView = Boolean(
    subjectUserId && subjectUserId !== currentUserId
  );
  const isManagerReview = isManagerView && canManageDirectReport === true;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<DevelopmentPlanRow[]>([]);
  const [objectiveCountByPlan, setObjectiveCountByPlan] = useState<
    Record<string, number>
  >({});

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  const [objectives, setObjectives] = useState<DevelopmentPlanObjectiveRow[]>(
    []
  );
  const [objectivesLoading, setObjectivesLoading] = useState(false);

  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPlanType, setCreatePlanType] =
    useState<DevelopmentPlanType>("annual");
  const [createStart, setCreateStart] = useState("");
  const [createEnd, setCreateEnd] = useState("");
  const [createSaving, setCreateSaving] = useState(false);

  const [showObjectiveModal, setShowObjectiveModal] = useState(false);
  const [objTitle, setObjTitle] = useState("");
  const [objDescription, setObjDescription] = useState("");
  const [objSuccess, setObjSuccess] = useState("");
  const [objDue, setObjDue] = useState("");
  const [objPriority, setObjPriority] = useState<
    "low" | "medium" | "high"
  >("medium");
  const [objSaving, setObjSaving] = useState(false);

  const [editingObjectiveId, setEditingObjectiveId] = useState<string | null>(
    null
  );
  const [editProgress, setEditProgress] = useState(0);
  const [editStatus, setEditStatus] =
    useState<DevelopmentPlanObjectiveRow["status"]>("not_started");
  const [objectiveActionLoading, setObjectiveActionLoading] = useState<
    string | null
  >(null);

  const [showBacklogPicker, setShowBacklogPicker] = useState(false);
  const [backlogGoals, setBacklogGoals] = useState<BacklogGoalRow[]>([]);
  const [backlogPickerLoading, setBacklogPickerLoading] = useState(false);

  const [showFromBacklogConfirm, setShowFromBacklogConfirm] = useState(false);
  const [fromBacklogSource, setFromBacklogSource] =
    useState<BacklogGoalRow | null>(null);
  const [fbTitle, setFbTitle] = useState("");
  const [fbDescription, setFbDescription] = useState("");
  const [fbSuccess, setFbSuccess] = useState("");
  const [fbDue, setFbDue] = useState("");
  const [fbPriority, setFbPriority] = useState<"low" | "medium" | "high">(
    "medium"
  );
  const [fbSaving, setFbSaving] = useState(false);

  const [planSubmitLoading, setPlanSubmitLoading] = useState(false);
  const [myManagerId, setMyManagerId] = useState<string | null | undefined>(
    undefined
  );
  const [managerActionLoading, setManagerActionLoading] = useState(false);
  const [managerNoteDraft, setManagerNoteDraft] = useState<
    Record<string, string>
  >({});
  const [managerNoteSavingId, setManagerNoteSavingId] = useState<string | null>(
    null
  );
  const [notesByObjective, setNotesByObjective] = useState<
    Record<string, DevelopmentPlanObjectiveNoteRow[]>
  >({});
  const [noteInputs, setNoteInputs] = useState<
    Record<string, { content: string; noteType: DevelopmentPlanObjectiveNoteType }>
  >({});
  const [noteSavingObjectiveId, setNoteSavingObjectiveId] = useState<
    string | null
  >(null);

  /** Per-objective: when true, long description and notes are hidden */
  const [objectiveDetailCollapsed, setObjectiveDetailCollapsed] = useState<
    Record<string, boolean>
  >({});

  const hasAutoSelectedManagerPlan = useRef(false);
  const lastPlansDebugFingerprint = useRef<string>("");
  const lastAutoSelectLogPlanId = useRef<string | null>(null);
  const onPlansChangedRef = useRef(onPlansChanged);
  onPlansChangedRef.current = onPlansChanged;

  const card = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    color: text,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    boxSizing: "border-box" as const,
  } as const;

  const labelStyle = {
    display: "grid" as const,
    gap: 6,
    fontSize: 13,
    color: mutedColor,
  };

  useEffect(() => {
    if (isManagerView || !activeOrgId) {
      setMyManagerId(undefined);
      return;
    }
    let cancelled = false;
    void fetchMyManagerId(supabase, activeOrgId, currentUserId).then((id) => {
      if (!cancelled) setMyManagerId(id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [isManagerView, activeOrgId, currentUserId]);

  const loadPlans = useCallback(
    async (opts?: { notifyParent?: boolean }) => {
      if (!activeOrgId?.trim() || !planOwnerId?.trim()) {
        setPlans([]);
        setObjectiveCountByPlan({});
        setError(null);
        setLoading(false);
        if (opts?.notifyParent) onPlansChangedRef.current?.();
        return;
      }

      setLoading(true);
      setError(null);
      const { data: planRows, error: planErr } = await supabase
        .from("development_plans")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", planOwnerId)
        .order("updated_at", { ascending: false });

      if (planErr) {
        console.error(planErr);
        setError(planErr.message);
        setPlans([]);
        setObjectiveCountByPlan({});
        setLoading(false);
        if (opts?.notifyParent) onPlansChangedRef.current?.();
        return;
      }

      const normalized = (planRows ?? []).map(normalizePlan);
      if (import.meta.env.DEV) {
        const fingerprint = `${planOwnerId}:${[...normalized]
          .map((p) => `${p.id}:${p.status}`)
          .sort()
          .join(",")}`;
        if (fingerprint !== lastPlansDebugFingerprint.current) {
          lastPlansDebugFingerprint.current = fingerprint;
          console.log("[my_team_debug] development_plans for user_id", planOwnerId, {
            count: normalized.length,
            ids: normalized.map((p) => p.id),
            statuses: normalized.map((p) => p.status),
          });
        }
      }
      setPlans(normalized);

      const { data: countRows, error: countErr } = await supabase
        .from("development_plan_objectives")
        .select("development_plan_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", planOwnerId);

      if (countErr) {
        console.error(countErr);
      }
      const counts: Record<string, number> = {};
      for (const row of countRows ?? []) {
        const pid = (row as { development_plan_id: string }).development_plan_id;
        counts[pid] = (counts[pid] ?? 0) + 1;
      }
      setObjectiveCountByPlan(counts);
      setLoading(false);
      if (opts?.notifyParent) onPlansChangedRef.current?.();
    },
    [activeOrgId, planOwnerId]
  );

  /** Clear selection before loading plans for a new subject (avoid stale plan ids). */
  useEffect(() => {
    setSelectedPlanId(null);
    lastPlansDebugFingerprint.current = "";
    lastAutoSelectLogPlanId.current = null;
  }, [planOwnerId]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!isManagerReview || !selectedPlan || selectedPlan.status !== "submitted") {
      return;
    }
    console.log("[approve_debug] Approve / Return buttons mounted (submitted plan)", {
      planId: selectedPlan.id,
      status: selectedPlan.status,
      selectedPlanId,
    });
  }, [isManagerReview, selectedPlan?.id, selectedPlan?.status, selectedPlanId]);

  useEffect(() => {
    hasAutoSelectedManagerPlan.current = false;
  }, [planOwnerId, canManageDirectReport]);

  useEffect(() => {
    if (!isManagerReview || loading) return;
    if (plans.length === 0) return;
    if (hasAutoSelectedManagerPlan.current) return;
    const primary = pickPrimaryPlanForReview(plans);
    if (!primary) return;
    if (import.meta.env.DEV) {
      if (lastAutoSelectLogPlanId.current !== primary.id) {
        lastAutoSelectLogPlanId.current = primary.id;
        console.log("[my_team_debug] auto-select primary plan", {
          id: primary.id,
          status: primary.status,
          title: primary.title,
        });
      }
    }
    void Promise.resolve().then(() => {
      setSelectedPlanId(primary.id);
      hasAutoSelectedManagerPlan.current = true;
    });
  }, [isManagerReview, loading, plans]);

  const loadObjectives = useCallback(
    async (planId: string) => {
      setObjectivesLoading(true);
      const { data, error: oErr } = await supabase
        .from("development_plan_objectives")
        .select("*")
        .eq("development_plan_id", planId)
        .eq("user_id", planOwnerId)
        .order("created_at", { ascending: true });
      setObjectivesLoading(false);
      if (oErr) {
        console.error(oErr);
        setObjectives([]);
        setNotesByObjective({});
        return;
      }
      const objs = (data ?? []).map(normalizeObjective);
      setObjectives(objs);
    },
    [planOwnerId]
  );

  const loadNotesForObjectiveIds = useCallback(
    async (objectiveIds: string[]) => {
      if (objectiveIds.length === 0) {
        setNotesByObjective({});
        return;
      }
      const { data, error: nErr } = await supabase
        .from("development_plan_objective_notes")
        .select("*")
        .in("development_plan_objective_id", objectiveIds)
        .order("created_at", { ascending: false });
      if (nErr) {
        console.error(nErr);
        setNotesByObjective({});
        return;
      }
      const by: Record<string, DevelopmentPlanObjectiveNoteRow[]> = {};
      for (const raw of data ?? []) {
        const n = normalizeObjectiveNote(raw);
        const oid = n.development_plan_objective_id;
        if (!by[oid]) by[oid] = [];
        by[oid].push(n);
      }
      for (const oid of objectiveIds) {
        if (!by[oid]) by[oid] = [];
        else
          by[oid].sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
      }
      setNotesByObjective(by);
    },
    []
  );

  useEffect(() => {
    if (!selectedPlanId) {
      setObjectives([]);
      setNotesByObjective({});
      return;
    }
    void loadObjectives(selectedPlanId);
  }, [selectedPlanId, loadObjectives]);

  useEffect(() => {
    if (objectives.length === 0) {
      setNotesByObjective({});
      return;
    }
    void loadNotesForObjectiveIds(objectives.map((o) => o.id));
  }, [objectives, loadNotesForObjectiveIds]);

  function openCreatePlanModal() {
    setCreateTitle("");
    setCreateDescription("");
    setCreatePlanType("annual");
    setCreateStart("");
    setCreateEnd("");
    setShowCreatePlan(true);
  }

  async function handleCreatePlan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isManagerView) return;
    const title = createTitle.trim();
    if (!title) {
      alert("Please enter a title.");
      return;
    }
    setCreateSaving(true);
    const { error: insErr } = await supabase.from("development_plans").insert({
      organisation_id: activeOrgId,
      user_id: planOwnerId,
      title,
      description: createDescription.trim() || null,
      plan_type: createPlanType,
      start_date: createStart.trim() || null,
      end_date: createEnd.trim() || null,
      status: "draft",
      updated_at: new Date().toISOString(),
    });
    setCreateSaving(false);
    if (insErr) {
      console.error(insErr);
      alert(insErr.message || "Could not create plan.");
      return;
    }
    setShowCreatePlan(false);
    await loadPlans({ notifyParent: true });
  }

  function openObjectiveModal() {
    setObjTitle("");
    setObjDescription("");
    setObjSuccess("");
    setObjDue("");
    setObjPriority("medium");
    setShowObjectiveModal(true);
  }

  const loadBacklogGoals = useCallback(async () => {
    if (isManagerView) {
      setBacklogGoals([]);
      setBacklogPickerLoading(false);
      return;
    }
    setBacklogPickerLoading(true);
    const { data, error: bErr } = await supabase
      .from("development_goals")
      .select(
        "id, title, description, competency_id, career_focus_source_id"
      )
      .eq("organisation_id", activeOrgId)
      .eq("user_id", currentUserId)
      .eq("lifecycle_status", "backlog")
      .order("updated_at", { ascending: false });
    setBacklogPickerLoading(false);
    if (bErr) {
      console.error(bErr);
      setBacklogGoals([]);
      return;
    }
    setBacklogGoals((data ?? []).map(parseBacklogGoal));
  }, [activeOrgId, currentUserId, isManagerView]);

  function openBacklogPicker() {
    setShowBacklogPicker(true);
    void loadBacklogGoals();
  }

  function beginFromBacklog(g: BacklogGoalRow) {
    setFromBacklogSource(g);
    setFbTitle(g.title);
    setFbDescription(g.description ?? "");
    setFbSuccess("");
    setFbDue("");
    setFbPriority("medium");
    setShowBacklogPicker(false);
    setShowFromBacklogConfirm(true);
  }

  function closeFromBacklogFlow() {
    setShowFromBacklogConfirm(false);
    setFromBacklogSource(null);
  }

  async function handleSaveFromBacklog(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isManagerView) return;
    if (!selectedPlanId || !fromBacklogSource) return;
    const title = fbTitle.trim();
    if (!title) {
      alert("Please enter a title.");
      return;
    }
    setFbSaving(true);
    const { error: insErr } = await supabase
      .from("development_plan_objectives")
      .insert({
        development_plan_id: selectedPlanId,
        organisation_id: activeOrgId,
        user_id: planOwnerId,
        source_goal_id: fromBacklogSource.id,
        competency_id: fromBacklogSource.competency_id,
        title,
        description: fbDescription.trim() || null,
        success_criteria: fbSuccess.trim() || null,
        due_date: fbDue.trim() || null,
        priority: fbPriority,
        progress: 0,
        status: "not_started",
        updated_at: new Date().toISOString(),
      });
    setFbSaving(false);
    if (insErr) {
      console.error(insErr);
      alert(insErr.message || "Could not add objective from backlog.");
      return;
    }
    closeFromBacklogFlow();
    await loadObjectives(selectedPlanId);
    await loadPlans({ notifyParent: true });
  }

  async function handleAddObjective(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isManagerView) return;
    if (!selectedPlanId) return;
    const title = objTitle.trim();
    if (!title) {
      alert("Please enter a title.");
      return;
    }
    setObjSaving(true);
    const { error: insErr } = await supabase
      .from("development_plan_objectives")
      .insert({
        development_plan_id: selectedPlanId,
        organisation_id: activeOrgId,
        user_id: planOwnerId,
        title,
        description: objDescription.trim() || null,
        success_criteria: objSuccess.trim() || null,
        due_date: objDue.trim() || null,
        priority: objPriority,
        progress: 0,
        status: "not_started",
        updated_at: new Date().toISOString(),
      });
    setObjSaving(false);
    if (insErr) {
      console.error(insErr);
      alert(insErr.message || "Could not add objective.");
      return;
    }
    setShowObjectiveModal(false);
    await loadObjectives(selectedPlanId);
    await loadPlans({ notifyParent: true });
  }

  function startEditObjective(o: DevelopmentPlanObjectiveRow) {
    setEditingObjectiveId(o.id);
    setEditProgress(o.progress);
    setEditStatus(o.status);
  }

  async function saveObjectiveEdits(objectiveId: string) {
    if (isManagerView) return;
    if (!selectedPlanId) return;
    setObjectiveActionLoading(objectiveId);
    const { error: uErr } = await supabase
      .from("development_plan_objectives")
      .update({
        progress: Math.max(0, Math.min(100, Math.round(editProgress))),
        status: editStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", objectiveId)
      .eq("user_id", planOwnerId);
    setObjectiveActionLoading(null);
    if (uErr) {
      console.error(uErr);
      alert(uErr.message || "Could not update objective.");
      return;
    }
    setEditingObjectiveId(null);
    await loadObjectives(selectedPlanId);
    await loadPlans({ notifyParent: true });
  }

  function dateRange(p: DevelopmentPlanRow): string {
    if (p.start_date && p.end_date) {
      return `${p.start_date} → ${p.end_date}`;
    }
    if (p.start_date) return `From ${p.start_date}`;
    if (p.end_date) return `Until ${p.end_date}`;
    return "—";
  }

  async function submitPlanForReview() {
    if (isManagerView) return;
    if (!selectedPlanId || !myManagerId) return;
    setPlanSubmitLoading(true);
    const { error: uErr } = await supabase
      .from("development_plans")
      .update({
        status: "submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedPlanId)
      .eq("user_id", planOwnerId)
      .eq("status", "draft");
    setPlanSubmitLoading(false);
    if (uErr) {
      console.error(uErr);
      alert(uErr.message || "Could not submit plan.");
      return;
    }
    await loadPlans({ notifyParent: true });
  }

  async function addObjectiveNote(objectiveId: string) {
    if (isManagerView) return;
    const input = noteInputs[objectiveId] ?? {
      content: "",
      noteType: "update" as DevelopmentPlanObjectiveNoteType,
    };
    const content = input.content.trim();
    if (!content) {
      alert("Please enter a note.");
      return;
    }
    setNoteSavingObjectiveId(objectiveId);
    const { error: insErr } = await supabase
      .from("development_plan_objective_notes")
      .insert({
        development_plan_objective_id: objectiveId,
        organisation_id: activeOrgId,
        user_id: currentUserId,
        note_type: input.noteType,
        content,
        updated_at: new Date().toISOString(),
      });
    setNoteSavingObjectiveId(null);
    if (insErr) {
      console.error(insErr);
      alert(insErr.message || "Could not add note.");
      return;
    }
    setNoteInputs((prev) => ({
      ...prev,
      [objectiveId]: { content: "", noteType: input.noteType },
    }));
    await loadNotesForObjectiveIds(objectives.map((o) => o.id));
  }

  async function activatePlanDirectly() {
    if (isManagerView) return;
    if (!selectedPlanId || myManagerId !== null) return;
    setPlanSubmitLoading(true);
    const { error: uErr } = await supabase
      .from("development_plans")
      .update({
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedPlanId)
      .eq("user_id", planOwnerId)
      .eq("status", "draft");
    setPlanSubmitLoading(false);
    if (uErr) {
      console.error(uErr);
      alert(uErr.message || "Could not activate plan.");
      return;
    }
    await loadPlans({ notifyParent: true });
  }

  async function managerSetPlanStatus(next: "active" | "draft") {
    if (import.meta.env.DEV) {
      console.log("[approve_debug] managerSetPlanStatus called", {
        next,
        isManagerReview,
        isManagerView,
        canManageDirectReport,
        selectedPlanId,
        selectedPlanStatus: selectedPlan?.status ?? null,
      });
    }
    if (!isManagerReview || !selectedPlanId) {
      if (import.meta.env.DEV) {
        console.warn("[approve_debug] early return", {
          reason: !isManagerReview ? "not_manager_review" : "no_selected_plan_id",
          isManagerReview,
          selectedPlanId,
        });
      }
      return;
    }
    setManagerActionLoading(true);
    const now = new Date().toISOString();
    if (import.meta.env.DEV) {
      console.log("[approve_debug] Supabase update starting", {
        planId: selectedPlanId,
        nextStatus: next,
        filterStatuses: ["submitted", "pending_review"],
      });
    }
    const { data: updatedRows, error: uErr } = await supabase
      .from("development_plans")
      .update({
        status: next,
        manager_reviewed_at: next === "active" ? now : null,
        updated_at: now,
      })
      .eq("id", selectedPlanId)
      .in("status", ["submitted", "pending_review"])
      .select("id, status");
    setManagerActionLoading(false);
    if (import.meta.env.DEV) {
      console.log("[approve_debug] Supabase response", {
        error: uErr?.message ?? null,
        updatedRows,
        rowCount: updatedRows?.length ?? 0,
      });
    }
    if (uErr) {
      console.error(uErr);
      alert(uErr.message || "Could not update plan status.");
      return;
    }
    if (!updatedRows?.length) {
      const msg =
        "No plan row was updated. The plan may still be stored with a legacy status in the database.";
      console.warn("[approve_debug]", msg, { selectedPlanId });
      alert(msg);
      return;
    }
    await loadPlans({ notifyParent: true });
  }

  async function addManagerNote(objectiveId: string) {
    if (!isManagerReview) return;
    const content = (managerNoteDraft[objectiveId] ?? "").trim();
    if (!content) {
      alert("Please enter a manager comment.");
      return;
    }
    setManagerNoteSavingId(objectiveId);
    const { error: insErr } = await supabase
      .from("development_plan_objective_notes")
      .insert({
        development_plan_objective_id: objectiveId,
        organisation_id: activeOrgId,
        user_id: currentUserId,
        note_type: "manager_comment",
        content,
        updated_at: new Date().toISOString(),
      });
    setManagerNoteSavingId(null);
    if (insErr) {
      console.error(insErr);
      alert(insErr.message || "Could not add comment.");
      return;
    }
    setManagerNoteDraft((prev) => ({ ...prev, [objectiveId]: "" }));
    await loadNotesForObjectiveIds(objectives.map((o) => o.id));
  }

  if (loading) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>Loading plans…</p>
    );
  }

  if (error) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{error}</p>
    );
  }

  if (selectedPlan) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <button
            type="button"
            onClick={() => {
              setSelectedPlanId(null);
              setEditingObjectiveId(null);
              setShowBacklogPicker(false);
              setShowFromBacklogConfirm(false);
              setFromBacklogSource(null);
            }}
            style={{ ...btnGhost, fontSize: 13, marginBottom: 10 }}
          >
            ← Back to plans
          </button>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: text,
                flex: "1 1 200px",
              }}
            >
              {selectedPlan.title}
            </h3>
            <span style={planStatusBadgeStyle(selectedPlan.status)}>
              {planStatusLabel(selectedPlan.status)}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
            {planTypeLabel(selectedPlan.plan_type)} · {dateRange(selectedPlan)}
          </p>
          {selectedPlan.description ? (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 14,
                color: text,
                lineHeight: 1.5,
              }}
            >
              {selectedPlan.description}
            </p>
          ) : null}
        </div>

        {isManagerReview ? (
          <div style={{ ...card, margin: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: mutedColor,
              }}
            >
              Manager review
            </div>
            {selectedPlan.status === "submitted" ? (
              <>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 13,
                    color: mutedColor,
                    lineHeight: 1.5,
                  }}
                >
                  Approve this plan or return it to draft so your team member can
                  edit.
                </p>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  <button
                    type="button"
                    disabled={managerActionLoading}
                    onClick={() => {
                      if (import.meta.env.DEV) {
                        console.log("[approve_debug] Approve plan click", {
                          planId: selectedPlanId,
                          planStatus: selectedPlan?.status,
                          managerActionLoading,
                          isManagerReview,
                        });
                      }
                      void managerSetPlanStatus("active");
                    }}
                    style={{ ...btn, fontSize: 13 }}
                  >
                    {managerActionLoading ? "Updating…" : "Approve plan"}
                  </button>
                  <button
                    type="button"
                    disabled={managerActionLoading}
                    onClick={() => {
                      if (import.meta.env.DEV) {
                        console.log("[approve_debug] Return to draft click", {
                          planId: selectedPlanId,
                        });
                      }
                      void managerSetPlanStatus("draft");
                    }}
                    style={{ ...btnGhost, fontSize: 13 }}
                  >
                    Return to draft
                  </button>
                </div>
              </>
            ) : (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 13,
                  color: mutedColor,
                  lineHeight: 1.5,
                }}
              >
                Review objectives and notes below. Add{" "}
                <strong style={{ color: text }}>manager comments</strong> on each
                objective as needed.
              </p>
            )}
          </div>
        ) : null}
        {isManagerView && !isManagerReview ? (
          <div style={{ ...card, margin: 0 }}>
            <p style={{ margin: 0, fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>
              You can view this person&apos;s plan. Approve, return to draft, and
              manager comments are only available to their direct manager in this
              workspace.
            </p>
          </div>
        ) : null}

        {selectedPlan.status === "draft" && !isManagerView ? (
          <div style={{ ...card, margin: 0 }}>
            {myManagerId === undefined ? (
              <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                Checking reporting line…
              </p>
            ) : myManagerId ? (
              <>
                <button
                  type="button"
                  disabled={planSubmitLoading}
                  onClick={() => void submitPlanForReview()}
                  style={{ ...btn, fontSize: 13 }}
                >
                  {planSubmitLoading ? "Submitting…" : "Submit for review"}
                </button>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  Submit when you are ready for your manager to review this plan.
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={planSubmitLoading}
                  onClick={() => void activatePlanDirectly()}
                  style={{ ...btn, fontSize: 13 }}
                >
                  {planSubmitLoading ? "Saving…" : "Activate plan"}
                </button>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  No manager is assigned in this workspace. Activate this plan when
                  you are ready to work on it.
                </p>
              </>
            )}
          </div>
        ) : null}
        {selectedPlan.status === "submitted" && !isManagerView ? (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: mutedColor,
              padding: "12px 14px",
              borderRadius: 8,
              border: `1px solid ${borderSubtle}`,
              backgroundColor: bg,
              lineHeight: 1.5,
            }}
          >
            {myManagerId
              ? "Awaiting manager review."
              : "Submitted. Follow up with your workspace admin if a manager should be assigned."}
          </p>
        ) : null}
        {selectedPlan.status === "active" ? (
          <p style={{ margin: 0, fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>
            {isManagerView
              ? "This plan is active."
              : "This plan is active. Update objectives and progress notes as you go."}
          </p>
        ) : null}
        {selectedPlan.status === "completed" ? (
          <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
            This plan is completed.
          </p>
        ) : null}
        {selectedPlan.status === "archived" ? (
          <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
            This plan is archived (read-only context for history).
          </p>
        ) : null}

        {!isManagerView ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button type="button" onClick={openObjectiveModal} style={btn}>
              Add objective
            </button>
            <button type="button" onClick={openBacklogPicker} style={btn}>
              Add from backlog
            </button>
          </div>
        ) : null}

        {objectivesLoading ? (
          <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
            Loading objectives…
          </p>
        ) : objectives.length === 0 ? (
          <div style={card}>
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              {isManagerView ? (
                "No objectives on this plan yet."
              ) : (
                <>
                  No objectives yet. Add one manually or use{" "}
                  <span style={{ color: text, fontWeight: 500 }}>
                    Add from backlog
                  </span>{" "}
                  to copy from your development backlog.
                </>
              )}
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
            {objectives.map((o) => (
              <li
                key={o.id}
                style={{
                  ...card,
                  margin: 0,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: text,
                      }}
                    >
                      {o.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: mutedColor,
                        marginTop: 4,
                      }}
                    >
                      {objectiveStatusLabel(o.status)} · Priority: {o.priority}{" "}
                      · {o.progress}%
                      {o.due_date ? ` · Due ${o.due_date}` : ""}
                    </div>
                    {o.source_goal_id ? (
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: 11,
                          color: mutedColor,
                          fontStyle: "italic",
                        }}
                      >
                        Created from backlog item
                      </p>
                    ) : null}
                  </div>
                  {!isManagerView ? (
                    <button
                      type="button"
                      onClick={() =>
                        editingObjectiveId === o.id
                          ? setEditingObjectiveId(null)
                          : startEditObjective(o)
                      }
                      style={{ ...btnGhost, fontSize: 12, flexShrink: 0 }}
                    >
                      {editingObjectiveId === o.id ? "Close" : "Update"}
                    </button>
                  ) : null}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setObjectiveDetailCollapsed((prev) => ({
                        ...prev,
                        [o.id]: !prev[o.id],
                      }))
                    }
                    style={{ ...btnGhost, fontSize: 11, padding: "4px 10px" }}
                  >
                    {objectiveDetailCollapsed[o.id]
                      ? "Show details & notes"
                      : "Hide details"}
                  </button>
                </div>
                {!objectiveDetailCollapsed[o.id] ? (
                  <>
                {o.description ? (
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: 13,
                      color: mutedColor,
                      lineHeight: 1.45,
                    }}
                  >
                    {o.description}
                  </p>
                ) : null}
                {o.success_criteria ? (
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 12,
                      color: mutedColor,
                      lineHeight: 1.45,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: text }}>
                      Success:{" "}
                    </span>
                    {o.success_criteria}
                  </p>
                ) : null}
                {o.due_date ? (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: mutedColor }}>
                    Due: {o.due_date}
                  </p>
                ) : null}

                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${borderSubtle}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: mutedColor,
                      marginBottom: 8,
                    }}
                  >
                    Progress notes
                  </div>
                  {(notesByObjective[o.id] ?? []).length === 0 ? (
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: 12,
                        color: mutedColor,
                      }}
                    >
                      No notes yet.
                    </p>
                  ) : (
                    <ul
                      style={{
                        margin: "0 0 12px",
                        padding: 0,
                        listStyle: "none",
                      }}
                    >
                      {(notesByObjective[o.id] ?? []).map((note) => (
                        <li key={note.id} style={{ marginBottom: 10 }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              padding: "2px 6px",
                              borderRadius: 4,
                              border: `1px solid ${borderSubtle}`,
                              color: mutedColor,
                            }}
                          >
                            {noteTypeLabel(note.note_type)}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: mutedColor,
                              marginLeft: 8,
                            }}
                          >
                            {formatNoteDate(note.created_at)}
                          </span>
                          <p
                            style={{
                              margin: "4px 0 0",
                              fontSize: 13,
                              color: text,
                              lineHeight: 1.45,
                            }}
                          >
                            {note.content}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!isManagerView ? (
                    <>
                      <label style={labelStyle}>
                        Note type
                        <select
                          value={noteInputs[o.id]?.noteType ?? "update"}
                          onChange={(e) =>
                            setNoteInputs((prev) => ({
                              ...prev,
                              [o.id]: {
                                content: prev[o.id]?.content ?? "",
                                noteType: e.target
                                  .value as DevelopmentPlanObjectiveNoteType,
                              },
                            }))
                          }
                          style={inputStyle}
                        >
                          <option value="update">Update</option>
                          <option value="blocker">Blocker</option>
                          <option value="reflection">Reflection</option>
                        </select>
                      </label>
                      <label style={{ ...labelStyle, marginTop: 8 }}>
                        Add note
                        <textarea
                          value={noteInputs[o.id]?.content ?? ""}
                          onChange={(e) =>
                            setNoteInputs((prev) => ({
                              ...prev,
                              [o.id]: {
                                content: e.target.value,
                                noteType: prev[o.id]?.noteType ?? "update",
                              },
                            }))
                          }
                          rows={2}
                          placeholder="What changed, what is blocking you, or what you learned…"
                          style={{
                            ...inputStyle,
                            resize: "vertical" as const,
                            fontFamily: "inherit",
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={noteSavingObjectiveId === o.id}
                        onClick={() => void addObjectiveNote(o.id)}
                        style={{ ...btn, fontSize: 13, marginTop: 8 }}
                      >
                        {noteSavingObjectiveId === o.id ? "Adding…" : "Add note"}
                      </button>
                    </>
                  ) : isManagerReview ? (
                    <>
                      <label style={{ ...labelStyle, marginTop: 4 }}>
                        Manager comment
                        <textarea
                          value={managerNoteDraft[o.id] ?? ""}
                          onChange={(e) =>
                            setManagerNoteDraft((prev) => ({
                              ...prev,
                              [o.id]: e.target.value,
                            }))
                          }
                          rows={2}
                          placeholder="Feedback for your team member…"
                          style={{
                            ...inputStyle,
                            resize: "vertical" as const,
                            fontFamily: "inherit",
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={managerNoteSavingId === o.id}
                        onClick={() => void addManagerNote(o.id)}
                        style={{ ...btn, fontSize: 13, marginTop: 8 }}
                      >
                        {managerNoteSavingId === o.id
                          ? "Adding…"
                          : "Add manager comment"}
                      </button>
                    </>
                  ) : isManagerView ? (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: mutedColor }}>
                      Manager comments are hidden (read-only view).
                    </p>
                  ) : null}
                </div>
                  </>
                ) : null}

                {!isManagerView && editingObjectiveId === o.id ? (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: `1px solid ${borderSubtle}`,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <label style={labelStyle}>
                      Progress ({editProgress}%)
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={editProgress}
                        onChange={(e) =>
                          setEditProgress(Number(e.target.value))
                        }
                        disabled={objectiveActionLoading === o.id}
                        style={{ width: "100%" }}
                      />
                    </label>
                    <label style={labelStyle}>
                      Status
                      <select
                        value={editStatus}
                        onChange={(e) =>
                          setEditStatus(
                            e.target.value as DevelopmentPlanObjectiveRow["status"]
                          )
                        }
                        disabled={objectiveActionLoading === o.id}
                        style={inputStyle}
                      >
                        <option value="not_started">Not started</option>
                        <option value="in_progress">In progress</option>
                        <option value="pending_manager_review">
                          Pending manager review
                        </option>
                        <option value="completed">Completed</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={objectiveActionLoading === o.id}
                      onClick={() => void saveObjectiveEdits(o.id)}
                      style={{ ...btn, fontSize: 13, justifySelf: "start" }}
                    >
                      {objectiveActionLoading === o.id ? "Saving…" : "Save"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {showObjectiveModal ? (
          <div
            role="dialog"
            aria-modal
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              padding: "24px 16px",
              overflow: "auto",
              backgroundColor: "rgba(0,0,0,0.55)",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowObjectiveModal(false);
            }}
          >
            <form
              onSubmit={handleAddObjective}
              style={{
                ...card,
                width: "100%",
                maxWidth: 440,
                marginTop: 32,
                display: "grid",
                gap: 14,
              }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 600,
                  color: text,
                }}
              >
                Add objective
              </h4>
              <label style={labelStyle}>
                Title
                <input
                  required
                  value={objTitle}
                  onChange={(e) => setObjTitle(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Description
                <textarea
                  value={objDescription}
                  onChange={(e) => setObjDescription(e.target.value)}
                  rows={3}
                  style={{
                    ...inputStyle,
                    resize: "vertical" as const,
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <label style={labelStyle}>
                Success criteria
                <textarea
                  value={objSuccess}
                  onChange={(e) => setObjSuccess(e.target.value)}
                  rows={2}
                  style={{
                    ...inputStyle,
                    resize: "vertical" as const,
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <label style={labelStyle}>
                Due date
                <input
                  type="date"
                  value={objDue}
                  onChange={(e) => setObjDue(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Priority
                <select
                  value={objPriority}
                  onChange={(e) =>
                    setObjPriority(e.target.value as "low" | "medium" | "high")
                  }
                  style={inputStyle}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  type="submit"
                  disabled={objSaving}
                  style={{ ...btn, fontSize: 13 }}
                >
                  {objSaving ? "Saving…" : "Add objective"}
                </button>
                <button
                  type="button"
                  disabled={objSaving}
                  onClick={() => setShowObjectiveModal(false)}
                  style={{ ...btn, fontSize: 13 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : null}

        {showBacklogPicker ? (
          <div
            role="dialog"
            aria-modal
            aria-labelledby="backlog-picker-title"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 52,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              padding: "24px 16px",
              overflow: "auto",
              backgroundColor: "rgba(0,0,0,0.55)",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowBacklogPicker(false);
            }}
          >
            <div
              style={{
                ...card,
                width: "100%",
                maxWidth: 480,
                marginTop: 32,
                display: "grid",
                gap: 14,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h4
                id="backlog-picker-title"
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 600,
                  color: text,
                }}
              >
                Add from backlog
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>
                Select a backlog development item to copy into this plan. The
                backlog remains unchanged.
              </p>
              {backlogPickerLoading ? (
                <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                  Loading backlog…
                </p>
              ) : backlogGoals.length === 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                  No backlog items in this workspace. Save career-linked
                  suggestions from My Career to backlog first.
                </p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                >
                  {backlogGoals.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => beginFromBacklog(g)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 14px",
                          borderRadius: 8,
                          border: `1px solid ${borderSubtle}`,
                          backgroundColor: bg,
                          cursor: "pointer",
                          color: text,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                            marginBottom: 4,
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 14 }}>
                            {g.title}
                          </span>
                          {g.career_focus_source_id ? (
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
                              Career-linked
                            </span>
                          ) : null}
                        </div>
                        {g.description ? (
                          <p
                            style={{
                              margin: 0,
                              fontSize: 13,
                              color: mutedColor,
                              lineHeight: 1.45,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical" as const,
                              overflow: "hidden",
                            }}
                          >
                            {g.description}
                          </p>
                        ) : (
                          <p
                            style={{
                              margin: 0,
                              fontSize: 12,
                              color: mutedColor,
                              fontStyle: "italic",
                            }}
                          >
                            No description
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setShowBacklogPicker(false)}
                style={{ ...btnGhost, fontSize: 13, justifySelf: "start" }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {showFromBacklogConfirm && fromBacklogSource ? (
          <div
            role="dialog"
            aria-modal
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 53,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              padding: "24px 16px",
              overflow: "auto",
              backgroundColor: "rgba(0,0,0,0.55)",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeFromBacklogFlow();
            }}
          >
            <form
              onSubmit={handleSaveFromBacklog}
              style={{
                ...card,
                width: "100%",
                maxWidth: 440,
                marginTop: 32,
                display: "grid",
                gap: 14,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h4
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 600,
                  color: text,
                }}
              >
                Add objective from backlog
              </h4>
              <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
                Edit the fields below, then save. The link to the backlog item is
                stored for traceability.
              </p>
              <label style={labelStyle}>
                Title
                <input
                  required
                  value={fbTitle}
                  onChange={(e) => setFbTitle(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Description
                <textarea
                  value={fbDescription}
                  onChange={(e) => setFbDescription(e.target.value)}
                  rows={3}
                  style={{
                    ...inputStyle,
                    resize: "vertical" as const,
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <label style={labelStyle}>
                Success criteria
                <textarea
                  value={fbSuccess}
                  onChange={(e) => setFbSuccess(e.target.value)}
                  rows={2}
                  style={{
                    ...inputStyle,
                    resize: "vertical" as const,
                    fontFamily: "inherit",
                  }}
                />
              </label>
              <label style={labelStyle}>
                Due date
                <input
                  type="date"
                  value={fbDue}
                  onChange={(e) => setFbDue(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Priority
                <select
                  value={fbPriority}
                  onChange={(e) =>
                    setFbPriority(e.target.value as "low" | "medium" | "high")
                  }
                  style={inputStyle}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  type="submit"
                  disabled={fbSaving}
                  style={{ ...btn, fontSize: 13 }}
                >
                  {fbSaving ? "Saving…" : "Save to plan"}
                </button>
                <button
                  type="button"
                  disabled={fbSaving}
                  onClick={() => closeFromBacklogFlow()}
                  style={{ ...btn, fontSize: 13 }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          {isManagerView ? "Team member plans" : "Development Plans"}
        </p>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          {isManagerView
            ? `Review ${subjectDisplayName ?? "this colleague"}'s development plans, objectives, and notes.`
            : "Create and manage your formal quarterly or annual development plans."}
        </p>
      </div>

      {!isManagerView ? (
        <div>
          <button type="button" onClick={openCreatePlanModal} style={btn}>
            Create plan
          </button>
        </div>
      ) : null}

      {plans.length === 0 ? (
        <div style={card}>
          <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
            {isManagerView
              ? "No development plan created yet."
              : "No development plans yet. Create an annual or quarterly plan to structure objectives for review cycles."}
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
          {plans.map((p) => (
            <li key={p.id} style={{ ...card, margin: 0, cursor: "pointer" }}>
              <button
                type="button"
                onClick={() => setSelectedPlanId(p.id)}
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
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      flex: "1 1 160px",
                    }}
                  >
                    {p.title}
                  </span>
                  <span style={planStatusBadgeStyle(p.status)}>
                    {planStatusLabel(p.status)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: mutedColor,
                    lineHeight: 1.5,
                  }}
                >
                  {planTypeLabel(p.plan_type)} · {dateRange(p)}
                  <br />
                  Objectives:{" "}
                  <strong style={{ color: text }}>
                    {objectiveCountByPlan[p.id] ?? 0}
                  </strong>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showCreatePlan ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreatePlan(false);
          }}
        >
          <form
            onSubmit={handleCreatePlan}
            style={{
              ...card,
              width: "100%",
              maxWidth: 440,
              marginTop: 32,
              display: "grid",
              gap: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Create development plan
            </h4>
            <label style={labelStyle}>
              Title
              <input
                required
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Description
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                rows={3}
                style={{
                  ...inputStyle,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <label style={labelStyle}>
              Plan type
              <select
                value={createPlanType}
                onChange={(e) =>
                  setCreatePlanType(e.target.value as DevelopmentPlanType)
                }
                style={inputStyle}
              >
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label style={labelStyle}>
              Start date
              <input
                type="date"
                value={createStart}
                onChange={(e) => setCreateStart(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              End date
              <input
                type="date"
                value={createEnd}
                onChange={(e) => setCreateEnd(e.target.value)}
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="submit"
                disabled={createSaving}
                style={{ ...btn, fontSize: 13 }}
              >
                {createSaving ? "Saving…" : "Create plan"}
              </button>
              <button
                type="button"
                disabled={createSaving}
                onClick={() => setShowCreatePlan(false)}
                style={{ ...btn, fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

import type { DevelopmentGoalRow } from "./types";

export function normalizeDevelopmentGoal(raw: unknown): DevelopmentGoalRow {
  const r = raw as Record<string, unknown>;
  let suggested_actions: string[] = [];
  const sa = r.suggested_actions;
  if (Array.isArray(sa)) {
    suggested_actions = sa.map(String);
  } else if (sa != null && typeof sa === "object") {
    suggested_actions = [];
  }
  const c = r.competencies;
  const comp = Array.isArray(c) ? c[0] : c;
  const lifecycleRaw = r.lifecycle_status;
  const lifecycle_status: DevelopmentGoalRow["lifecycle_status"] =
    lifecycleRaw === "backlog" ||
    lifecycleRaw === "active" ||
    lifecycleRaw === "completed"
      ? lifecycleRaw
      : "active";

  return {
    id: String(r.id),
    organisation_id: String(r.organisation_id),
    user_id: String(r.user_id),
    competency_id:
      r.competency_id === null || r.competency_id === undefined
        ? null
        : String(r.competency_id),
    current_level: String(r.current_level ?? ""),
    target_level: String(r.target_level ?? ""),
    relevance: String(r.relevance ?? "medium"),
    title: String(r.title ?? ""),
    description:
      r.description === null || r.description === undefined
        ? null
        : String(r.description),
    suggested_actions,
    status: r.status as DevelopmentGoalRow["status"],
    progress: Number(r.progress ?? 0),
    lifecycle_status,
    career_focus_source_id:
      r.career_focus_source_id === null ||
      r.career_focus_source_id === undefined
        ? null
        : String(r.career_focus_source_id),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    competencies: comp as DevelopmentGoalRow["competencies"],
  };
}

export function competencyNameFromGoal(g: DevelopmentGoalRow): string {
  if (!g.competency_id) {
    return g.title?.trim() || "Development focus";
  }
  const c = g.competencies;
  const comp = Array.isArray(c) ? c[0] : c;
  if (comp && typeof comp === "object" && "name" in comp) {
    return String((comp as { name?: string }).name ?? "").trim() || "Competency";
  }
  return "Competency";
}

export function formatDevelopmentGoalNoteTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

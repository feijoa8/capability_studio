import { supabase } from "../../lib/supabase";
import type {
  ApplicationEvaluationRow,
  ApplicationEvaluationStatus,
  EvidenceSnapshotV1,
  JobEvidenceComparison,
  RoleAnalysisExtraction,
} from "./types";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export function parseRoleAnalysis(raw: unknown): RoleAnalysisExtraction | null {
  const o = asRecord(raw);
  if (!o) return null;
  const role_summary =
    typeof o.role_summary === "string" ? o.role_summary.trim() : "";
  if (role_summary.length < 20) return null;
  const strArr = (k: string) =>
    Array.isArray(o[k])
      ? (o[k] as unknown[])
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((s) => s.trim())
      : [];
  const optStr = (k: string) =>
    typeof o[k] === "string" && (o[k] as string).trim()
      ? (o[k] as string).trim()
      : null;
  return {
    job_title: optStr("job_title"),
    company: optStr("company"),
    location: optStr("location"),
    role_summary,
    key_competencies: strArr("key_competencies"),
    skills: strArr("skills"),
    methods_practices: strArr("methods_practices"),
    tools_platforms: strArr("tools_platforms"),
    industry_domain: optStr("industry_domain"),
    watch_outs: strArr("watch_outs"),
    questions_to_ask: strArr("questions_to_ask"),
    key_role_signals: strArr("key_role_signals"),
  };
}

export function parseComparison(raw: unknown): JobEvidenceComparison | null {
  const o = asRecord(raw);
  if (!o) return null;
  const match_score =
    typeof o.match_score === "number" ? Math.round(o.match_score) : NaN;
  if (!Number.isFinite(match_score)) return null;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  const competency_summary =
    typeof o.competency_summary === "string" ? o.competency_summary.trim() : "";
  if (summary.length < 5 || competency_summary.length < 5) return null;
  const strArr = (k: string) =>
    Array.isArray(o[k])
      ? (o[k] as unknown[])
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((s) => s.trim())
      : [];
  return {
    match_score: Math.max(0, Math.min(100, match_score)),
    summary,
    strengths: strArr("strengths"),
    partial_coverage: strArr("partial_coverage"),
    gaps: strArr("gaps"),
    competency_summary,
  };
}

function normalizeRow(row: Record<string, unknown>): ApplicationEvaluationRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    status: row.status === "ready" ? "ready" : "draft",
    title_hint:
      typeof row.title_hint === "string" ? row.title_hint : row.title_hint
        ? String(row.title_hint)
        : null,
    company_hint:
      typeof row.company_hint === "string"
        ? row.company_hint
        : row.company_hint
          ? String(row.company_hint)
          : null,
    source_url:
      typeof row.source_url === "string" ? row.source_url : row.source_url
        ? String(row.source_url)
        : null,
    raw_description: String(row.raw_description ?? ""),
    role_analysis: (row.role_analysis as ApplicationEvaluationRow["role_analysis"]) ?? {},
    evidence_snapshot: (row.evidence_snapshot as EvidenceSnapshotV1 | null) ?? null,
    comparison_result: (row.comparison_result as JobEvidenceComparison | null) ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function listApplicationEvaluations(): Promise<
  ApplicationEvaluationRow[]
> {
  const { data, error } = await supabase
    .from("application_evaluations")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => normalizeRow(r as Record<string, unknown>));
}

export async function getApplicationEvaluation(
  id: string,
): Promise<ApplicationEvaluationRow | null> {
  const { data, error } = await supabase
    .from("application_evaluations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return normalizeRow(data as Record<string, unknown>);
}

export async function insertApplicationEvaluation(input: {
  title_hint: string | null;
  company_hint: string | null;
  source_url: string | null;
  raw_description: string;
  role_analysis: RoleAnalysisExtraction | Record<string, unknown>;
  evidence_snapshot: EvidenceSnapshotV1 | null;
  comparison_result: JobEvidenceComparison | null;
  status: ApplicationEvaluationStatus;
}): Promise<ApplicationEvaluationRow> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("application_evaluations")
    .insert({
      user_id: uid,
      title_hint: input.title_hint,
      company_hint: input.company_hint,
      source_url: input.source_url,
      raw_description: input.raw_description,
      role_analysis: input.role_analysis,
      evidence_snapshot: input.evidence_snapshot,
      comparison_result: input.comparison_result,
      status: input.status,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return normalizeRow(data as Record<string, unknown>);
}

export async function updateApplicationEvaluation(
  id: string,
  patch: Partial<{
    title_hint: string | null;
    company_hint: string | null;
    source_url: string | null;
    raw_description: string;
    role_analysis: RoleAnalysisExtraction | Record<string, unknown>;
    evidence_snapshot: EvidenceSnapshotV1 | null;
    comparison_result: JobEvidenceComparison | null;
    status: ApplicationEvaluationStatus;
  }>,
): Promise<ApplicationEvaluationRow> {
  const { data, error } = await supabase
    .from("application_evaluations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return normalizeRow(data as Record<string, unknown>);
}

export async function deleteApplicationEvaluation(id: string): Promise<void> {
  const { error } = await supabase.from("application_evaluations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type JobPostingSourceResolutionMeta = {
  kind: "manual_text" | "external_url" | "internal_posting";
  fetched_url?: string;
  internal_posting_id?: string;
};

export type ExtractJobPostingResult = {
  extraction: RoleAnalysisExtraction;
  source_resolution?: JobPostingSourceResolutionMeta;
  /** Plain text used for AI (e.g. after URL fetch); client should mirror into the description field for saving. */
  resolved_posting_text?: string;
};

type ExtractResponse = {
  error?: string;
  extraction?: RoleAnalysisExtraction;
  source_resolution?: JobPostingSourceResolutionMeta;
  resolved_posting_text?: string;
};

/**
 * Resolves posting text server-side: pasted body (if long enough), else ScrapingBee fetch from source_url.
 * Optional internal_posting_id is reserved for in-platform jobs (not yet implemented).
 */
export async function requestExtractJobPosting(input: {
  raw_description?: string | null;
  title_hint?: string | null;
  company_hint?: string | null;
  source_url?: string | null;
  internal_posting_id?: string | null;
}): Promise<ExtractJobPostingResult> {
  const { data, error } = await supabase.functions.invoke("extract-job-posting", {
    body: {
      raw_description: input.raw_description ?? null,
      title_hint: input.title_hint ?? null,
      company_hint: input.company_hint ?? null,
      source_url: input.source_url ?? null,
      internal_posting_id: input.internal_posting_id ?? null,
    },
  });

  if (error) {
    throw new Error(error.message ?? "Job extraction request failed.");
  }

  const payload = data as ExtractResponse | null;
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.extraction) {
    throw new Error("No extraction returned from service.");
  }
  return {
    extraction: payload.extraction,
    source_resolution: payload.source_resolution,
    resolved_posting_text: payload.resolved_posting_text,
  };
}

type CompareResponse = {
  error?: string;
  comparison?: JobEvidenceComparison;
  evidence_snapshot?: EvidenceSnapshotV1;
};

export async function requestCompareJobToEvidence(
  role_analysis: RoleAnalysisExtraction,
): Promise<{ comparison: JobEvidenceComparison; evidence_snapshot: EvidenceSnapshotV1 }> {
  const { data, error } = await supabase.functions.invoke("compare-job-to-evidence", {
    body: { role_analysis },
  });

  if (error) {
    throw new Error(error.message ?? "Comparison request failed.");
  }

  const payload = data as CompareResponse | null;
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.comparison || !payload?.evidence_snapshot) {
    throw new Error("Incomplete comparison response.");
  }
  return {
    comparison: payload.comparison,
    evidence_snapshot: payload.evidence_snapshot,
  };
}

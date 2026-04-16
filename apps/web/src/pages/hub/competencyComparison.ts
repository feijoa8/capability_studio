/**
 * Shared competency vs requirement comparison (Member Capability + My Competencies).
 */

import { mutedColor } from "./hubTheme";

export type OrgUserCompetencyRow = {
  id: string;
  competency_id: string;
  current_level: string;
  assessment_source: string;
  competency_name?: string;
  /** User who last set the agreed level (auth.users.id) */
  last_updated_by?: string | null;
  updated_at?: string | null;
};

export type OrgUserCompetencyAssessmentRow = {
  id: string;
  competency_id: string;
  contributor_type: string;
  contributor_user_id: string;
  assessed_level: string;
  created_at: string;
  competency_name?: string;
};

/** Mirrors job_profile_competencies.relevance (low | medium | high) */
export type JobProfileRelevance = "low" | "medium" | "high";

export type JobRequirementRow = {
  competency_id: string;
  required_level: string | null;
  is_required: boolean;
  relevance: JobProfileRelevance;
  competencies: { id: string; name: string } | null;
  /** From competencies.competency_type when join includes it */
  competency_type?: string | null;
  /** From competencies.subject_id / competency_subjects when join includes them */
  subject_id?: string | null;
  subject_name?: string | null;
  subject_type?: string | null;
  practice_name?: string | null;
};

/** Extract subject/practice metadata from embedded `competencies` (optional; safe on minimal joins). */
export function extractCompetencySubjectMeta(comp: unknown): {
  competency_type?: string | null;
  subject_id?: string | null;
  subject_name?: string | null;
  subject_type?: string | null;
  practice_name?: string | null;
} {
  if (!comp || typeof comp !== "object") return {};
  const c = comp as Record<string, unknown>;
  const competency_type =
    typeof c.competency_type === "string" ? c.competency_type : null;
  const subject_id =
    typeof c.subject_id === "string" ? c.subject_id : null;
  const subj = c.competency_subjects;
  const sub = Array.isArray(subj) ? subj[0] : subj;
  let subject_name: string | null = null;
  let subject_type: string | null = null;
  let practice_name: string | null = null;
  if (sub && typeof sub === "object") {
    const s = sub as Record<string, unknown>;
    subject_name = typeof s.name === "string" ? s.name : null;
    subject_type = typeof s.type === "string" ? s.type : null;
    const pr = s.competency_practices;
    const p = Array.isArray(pr) ? pr[0] : pr;
    if (p && typeof p === "object" && "name" in p) {
      const n = String((p as { name?: string }).name ?? "").trim();
      practice_name = n || null;
    }
  }
  return {
    competency_type,
    subject_id,
    subject_name,
    subject_type,
    practice_name,
  };
}

export type LevelDef = {
  competency_id: string;
  level_name: string;
  level_order: number;
};

export type GapStatus = "Gap" | "Met" | "Exceeds" | "Not assessed" | "—";

export type ConfidenceTier = "Low" | "Medium" | "High";

/** Role vs current comparison — Competency | Required | Current | Gap | Relevance | Confidence */
export const COMPARISON_GRID =
  "minmax(132px,1.3fr) minmax(68px,0.42fr) minmax(96px,0.8fr) minmax(80px,0.5fr) minmax(64px,0.42fr) minmax(92px,0.75fr)";

const WEIGHTS: Record<string, number> = {
  self: 1,
  peer_360: 1,
  manager: 2,
  learning_lead: 2,
  admin: 3,
};

const LEVEL_TO_SCORE: Record<string, number> = {
  Beginner: 1,
  Intermediate: 2,
  Advanced: 3,
  Expert: 4,
};

/** Numeric 1–4 score for a level name (dashboards, averages). */
export function levelNameToNumericScore(
  level: string | null | undefined
): number | null {
  const t = level?.trim();
  if (!t) return null;
  const key = Object.keys(LEVEL_TO_SCORE).find(
    (k) => k.toLowerCase() === t.toLowerCase()
  );
  return key != null ? LEVEL_TO_SCORE[key] : null;
}

function contributorWeight(contributorType: string): number {
  const k = contributorType.trim().toLowerCase();
  return WEIGHTS[k] ?? 1;
}

function assessedLevelToNumericScore(assessedLevel: string): number | null {
  const t = assessedLevel.trim();
  if (!t) return null;
  const key = Object.keys(LEVEL_TO_SCORE).find(
    (k) => k.toLowerCase() === t.toLowerCase()
  );
  return key != null ? LEVEL_TO_SCORE[key] : null;
}

function scoreToLevel(score: number): string {
  if (score < 1.5) return "Beginner";
  if (score < 2.5) return "Intermediate";
  if (score < 3.5) return "Advanced";
  return "Expert";
}

export function normalizeAssessmentRows(
  data: unknown
): OrgUserCompetencyAssessmentRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as {
      id: string;
      competency_id: string;
      contributor_type: string;
      contributor_user_id: string;
      assessed_level: string;
      created_at: string;
      competencies?:
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
    };
    const c = row.competencies;
    const comp = Array.isArray(c) ? (c[0] ?? null) : (c ?? null);
    const competency_name =
      comp && typeof comp === "object" && "name" in comp
        ? String((comp as { name?: string }).name ?? "").trim() || undefined
        : undefined;
    return {
      id: row.id,
      competency_id: row.competency_id,
      contributor_type: row.contributor_type,
      contributor_user_id: row.contributor_user_id,
      assessed_level: row.assessed_level,
      created_at: row.created_at,
      competency_name,
    };
  });
}

export function normalizeOrgUserCompetencyRows(
  data: unknown
): OrgUserCompetencyRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as {
      id: string;
      competency_id: string;
      current_level: string;
      assessment_source: string;
      last_updated_by?: string | null;
      updated_at?: string | null;
      competencies?:
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
    };
    const c = row.competencies;
    const comp = Array.isArray(c) ? (c[0] ?? null) : (c ?? null);
    const competency_name =
      comp && typeof comp === "object" && "name" in comp
        ? String((comp as { name?: string }).name ?? "").trim() || undefined
        : undefined;
    return {
      id: row.id,
      competency_id: row.competency_id,
      current_level: row.current_level,
      assessment_source: row.assessment_source,
      competency_name,
      last_updated_by: row.last_updated_by ?? undefined,
      updated_at: row.updated_at ?? undefined,
    };
  });
}

function parseJobRelevance(raw: string | null | undefined): JobProfileRelevance {
  const v = (raw ?? "medium").toLowerCase();
  if (v === "low" || v === "high") return v;
  return "medium";
}

export function relevanceLabel(r: JobProfileRelevance): string {
  if (r === "low") return "Low";
  if (r === "high") return "High";
  return "Medium";
}

export function normalizeJobRequirementRows(data: unknown): JobRequirementRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as {
      competency_id: string;
      required_level: string | null;
      is_required: boolean;
      relevance?: string | null;
      competencies?:
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
    };
    const c = row.competencies;
    const comp = Array.isArray(c) ? (c[0] ?? null) : (c ?? null);
    const meta = extractCompetencySubjectMeta(comp);
    return {
      competency_id: row.competency_id,
      required_level: row.required_level,
      is_required: Boolean(row.is_required),
      relevance: parseJobRelevance(row.relevance),
      competencies: comp,
      ...meta,
    };
  });
}

/** Weighted aggregation only — unchanged algorithm */
function computeDerivedLevelFromAssessments(
  competencyId: string,
  assessments: OrgUserCompetencyAssessmentRow[]
): {
  level: string | null;
  weightedInputCount: number;
  weightedScore: number | null;
} {
  const forComp = assessments.filter((a) => a.competency_id === competencyId);

  let weightSum = 0;
  let weightedSum = 0;
  let usedInputs = 0;

  for (const a of forComp) {
    const score = assessedLevelToNumericScore(a.assessed_level);
    if (score == null) continue;
    const w = contributorWeight(a.contributor_type);
    weightSum += w;
    weightedSum += score * w;
    usedInputs += 1;
  }

  if (weightSum <= 0 || usedInputs === 0) {
    return {
      level: null,
      weightedInputCount: 0,
      weightedScore: null,
    };
  }

  const avg = weightedSum / weightSum;
  return {
    level: scoreToLevel(avg),
    weightedInputCount: usedInputs,
    weightedScore: avg,
  };
}

export function resolveCurrentLevelSource(
  competencyId: string,
  uc: OrgUserCompetencyRow | undefined,
  assessments: OrgUserCompetencyAssessmentRow[]
): {
  level: string | null;
  /** Input-derived level (always from aggregation when inputs exist) */
  derivedLevel: string | null;
  isAgreed: boolean;
  weightedInputCount: number;
  weightedScore: number | null;
} {
  const derived = computeDerivedLevelFromAssessments(
    competencyId,
    assessments
  );

  const agreed = uc?.current_level?.trim();
  if (agreed) {
    return {
      level: agreed,
      derivedLevel: derived.level,
      isAgreed: true,
      weightedInputCount: derived.weightedInputCount,
      weightedScore: derived.weightedScore,
    };
  }

  return {
    level: derived.level,
    derivedLevel: derived.level,
    isAgreed: false,
    weightedInputCount: derived.weightedInputCount,
    weightedScore: derived.weightedScore,
  };
}

export function computeConfidence(
  competencyId: string,
  isAgreed: boolean,
  assessments: OrgUserCompetencyAssessmentRow[]
): { tier: ConfidenceTier; label: string } {
  if (isAgreed) {
    return { tier: "High", label: "Agreed" };
  }

  const active = assessments.filter((a) => a.competency_id === competencyId);
  const count = active.length;
  const contributors = [
    ...new Set(active.map((a) => a.contributor_type.trim().toLowerCase())),
  ];

  if (contributors.length === 1 && contributors[0] === "self") {
    return { tier: "Low", label: "Self only" };
  }

  if (contributors.some((c) => c === "manager")) {
    return { tier: "Medium", label: "Manager validated" };
  }

  if (count >= 2) {
    return { tier: "Medium", label: "Multiple inputs" };
  }

  return { tier: "Low", label: "Limited data" };
}

export type ContributorConflictInfo = {
  hasConflict: boolean;
  detailLine: string | null;
};

function contributorTypeLabel(contributorType: string): string {
  const k = contributorType.trim().toLowerCase();
  const map: Record<string, string> = {
    self: "Self",
    manager: "Manager",
    learning_lead: "Learning lead",
    admin: "Admin",
    company_admin: "Company admin",
    peer_360: "Peer",
  };
  return map[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
}

/**
 * Detects whether the latest assessment per contributor type disagrees on level
 * for this competency (does not change weighted aggregation).
 */
export function contributorConflictForCompetency(
  competencyId: string,
  assessments: OrgUserCompetencyAssessmentRow[]
): ContributorConflictInfo {
  const forComp = assessments.filter((a) => a.competency_id === competencyId);
  const latestByType = new Map<string, OrgUserCompetencyAssessmentRow>();
  for (const a of forComp) {
    const t = a.contributor_type.trim().toLowerCase();
    const cur = latestByType.get(t);
    if (!cur || a.created_at > cur.created_at) {
      latestByType.set(t, a);
    }
  }
  if (latestByType.size < 2) {
    return { hasConflict: false, detailLine: null };
  }
  const levels = [...latestByType.values()].map((a) =>
    a.assessed_level.trim().toLowerCase()
  );
  if (new Set(levels).size <= 1) {
    return { hasConflict: false, detailLine: null };
  }
  const parts = [...latestByType.values()].map((a) => {
    const lvl = a.assessed_level.trim();
    return `${contributorTypeLabel(a.contributor_type)}: ${lvl || "Not assessed"}`;
  });
  return {
    hasConflict: true,
    detailLine: parts.join(" · "),
  };
}

export function confidenceTierColor(tier: ConfidenceTier): string {
  switch (tier) {
    case "High":
      return "#7ecf9a";
    case "Medium":
      return "#d4a534";
    case "Low":
      return mutedColor;
    default:
      return mutedColor;
  }
}

export function levelOrder(
  competencyId: string,
  levelName: string | null | undefined,
  defs: LevelDef[]
): number | null {
  if (!levelName) return null;
  const row = defs.find(
    (d) =>
      d.competency_id === competencyId && d.level_name.trim() === levelName.trim()
  );
  return row != null ? row.level_order : null;
}

export function gapStatus(
  currentOrder: number | null,
  requiredOrder: number | null,
  hasCurrentLevel: boolean
): GapStatus {
  if (requiredOrder == null) return "—";
  if (!hasCurrentLevel) return "Not assessed";
  if (currentOrder == null) return "Not assessed";
  if (currentOrder < requiredOrder) return "Gap";
  if (currentOrder === requiredOrder) return "Met";
  return "Exceeds";
}

/** Three-way comparison vs required level (for role gap UI); unassessed = no usable current order */
export type GapTriState = "below" | "meets" | "above" | "unassessed";

export function gapTriState(
  currentOrder: number | null,
  requiredOrder: number | null,
  hasCurrentLevel: boolean
): GapTriState {
  if (requiredOrder == null) return "unassessed";
  if (!hasCurrentLevel || currentOrder == null) return "unassessed";
  if (currentOrder < requiredOrder) return "below";
  if (currentOrder === requiredOrder) return "meets";
  return "above";
}

export function gapTriLabel(tri: GapTriState): string {
  switch (tri) {
    case "below":
      return "Below";
    case "meets":
      return "Meets";
    case "above":
      return "Above";
    case "unassessed":
      return "Unassessed";
    default:
      return "—";
  }
}

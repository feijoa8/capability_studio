import type { HiringApplicationRow } from "./hiringApi";

export type HiringEvaluationBand = "strong" | "moderate" | "low";

export type HiringEvaluationSnapshotV1 = {
  strengths?: string[];
  partialCoverage?: string[];
  gaps?: string[];
  overlapCount?: number;
  jobSignalCount?: number;
};

const FIT_META: Record<
  HiringEvaluationBand,
  { label: string; dotColor: string; labelColor: string }
> = {
  strong: {
    label: "Strong fit",
    dotColor: "#22c55e",
    labelColor: "#86efac",
  },
  moderate: {
    label: "Moderate fit",
    dotColor: "#eab308",
    labelColor: "#fde047",
  },
  low: {
    label: "Low fit",
    dotColor: "#ef4444",
    labelColor: "#fca5a5",
  },
};

export function scoreToEvaluationBand(score: number): HiringEvaluationBand {
  if (score >= 70) return "strong";
  if (score >= 40) return "moderate";
  return "low";
}

function strArrFromSnapshot(o: Record<string, unknown>, k: string, max: number): string[] {
  const v = o[k];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
}

export function parseEvaluationSnapshot(raw: unknown): HiringEvaluationSnapshotV1 {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  return {
    strengths: strArrFromSnapshot(o, "strengths", 5),
    partialCoverage: strArrFromSnapshot(o, "partialCoverage", 5),
    gaps: strArrFromSnapshot(o, "gaps", 5),
    overlapCount: typeof o.overlapCount === "number" ? o.overlapCount : undefined,
    jobSignalCount: typeof o.jobSignalCount === "number" ? o.jobSignalCount : undefined,
  };
}

export type FitIndicator = {
  band: HiringEvaluationBand | null;
  label: string;
  dotColor: string;
  labelColor: string;
};

/** Card + panel: colour system from persisted band, else score, else not evaluated. */
export function resolveFitIndicator(row: HiringApplicationRow): FitIndicator {
  const raw = row.evaluation_band?.trim().toLowerCase();
  if (raw === "strong" || raw === "moderate" || raw === "low") {
    const m = FIT_META[raw];
    return { band: raw, label: m.label, dotColor: m.dotColor, labelColor: m.labelColor };
  }
  const sc = row.evaluation_score;
  if (sc != null && Number.isFinite(Number(sc))) {
    const band = scoreToEvaluationBand(Number(sc));
    const m = FIT_META[band];
    return { band, label: m.label, dotColor: m.dotColor, labelColor: m.labelColor };
  }
  return {
    band: null,
    label: "Not evaluated",
    dotColor: "#6b7280",
    labelColor: "#9ca3af",
  };
}

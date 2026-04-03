import type { DevelopmentPlanRow } from "./types";

/**
 * Manager review: submitted plans first, then active, then most recent draft.
 * Falls back to most recently updated plan for completed/archived.
 */
export function pickPrimaryPlanForReview(
  plans: DevelopmentPlanRow[]
): DevelopmentPlanRow | null {
  if (plans.length === 0) return null;
  const submitted = plans.filter((p) => p.status === "submitted");
  if (submitted.length > 0) {
    return [...submitted].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
  }
  const active = plans.find((p) => p.status === "active");
  if (active) return active;
  const drafts = plans.filter((p) => p.status === "draft");
  if (drafts.length > 0) {
    return [...drafts].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];
  }
  return [...plans].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  )[0] ?? null;
}

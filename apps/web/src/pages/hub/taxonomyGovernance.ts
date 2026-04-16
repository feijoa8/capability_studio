/** Governance for capability areas & subjects (orthogonal to lifecycle status on subjects). */
export type TaxonomyGovernanceStatus = "draft" | "settled" | "protected";

export function parseTaxonomyGovernanceStatus(
  v: string | null | undefined
): TaxonomyGovernanceStatus {
  if (v === "settled" || v === "protected") return v;
  return "draft";
}

export function isProtectedGovernance(
  g: TaxonomyGovernanceStatus
): boolean {
  return g === "protected";
}

export function isSettledOrProtectedGovernance(
  g: TaxonomyGovernanceStatus
): boolean {
  return g === "settled" || g === "protected";
}

export const TAXONOMY_GOVERNANCE_LABEL: Record<TaxonomyGovernanceStatus, string> =
  {
    draft: "Draft",
    settled: "Settled",
    protected: "Protected",
  };

import {
  type TaxonomyGovernanceStatus,
  TAXONOMY_GOVERNANCE_LABEL,
} from "./taxonomyGovernance";
import { borderSubtle, mutedColor, text } from "./hubTheme";

const badgeStyle: Record<
  TaxonomyGovernanceStatus,
  { bg: string; border: string; color: string }
> = {
  draft: {
    bg: "rgba(120, 120, 140, 0.12)",
    border: borderSubtle,
    color: mutedColor,
  },
  settled: {
    bg: "rgba(80, 140, 200, 0.14)",
    border: "rgba(80, 140, 200, 0.35)",
    color: "#7eb8e8",
  },
  protected: {
    bg: "rgba(180, 120, 60, 0.18)",
    border: "rgba(212, 168, 75, 0.45)",
    color: "#e8c47a",
  },
};

export function GovernanceTaxonomyBadge({
  status,
  compact,
}: {
  status: TaxonomyGovernanceStatus;
  compact?: boolean;
}) {
  const st = badgeStyle[status];
  return (
    <span
      title={TAXONOMY_GOVERNANCE_LABEL[status]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 3 : 4,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: compact ? "2px 6px" : "3px 8px",
        borderRadius: 5,
        border: `1px solid ${st.border}`,
        backgroundColor: st.bg,
        color: st.color,
        flexShrink: 0,
      }}
    >
      {status === "protected" ? (
        <span aria-hidden style={{ fontSize: compact ? 10 : 11, color: text }}>
          🔒
        </span>
      ) : null}
      {TAXONOMY_GOVERNANCE_LABEL[status]}
    </span>
  );
}

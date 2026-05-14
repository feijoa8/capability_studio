import type { DevelopmentFocusItemRow } from "./types";

/**
 * UI tags for backlog cards — source and org-context signals (not row “ownership”).
 * Does not encode candidate account type (candidates are not in My Development).
 */
export function focusItemBacklogTags(
  item: DevelopmentFocusItemRow,
): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const sig = item.related_signals && typeof item.related_signals === "object" && !Array.isArray(item.related_signals)
    ? (item.related_signals as Record<string, unknown>)
    : {};

  const contributing =
    typeof sig.contributing_organisation_id === "string" &&
    (sig.contributing_organisation_id as string).length > 0;

  if (item.organisation_id || contributing) {
    out.push({ key: "org_ctx", label: "From organisation" });
  }

  if (
    typeof sig.career_focus_source_id === "string" ||
    typeof sig.career_focus_id === "string" ||
    sig.from_career === true
  ) {
    out.push({ key: "career_sig", label: "From career" });
  }
  if (typeof sig.role_expectation_id === "string" || /expectation|role gap/i.test(JSON.stringify(sig))) {
    out.push({ key: "role_sig", label: "Role expectation" });
  }
  if (typeof sig.assessment_gap_id === "string" || /assessment|gap|coverage/i.test(JSON.stringify(sig))) {
    out.push({ key: "assess", label: "Assessment gap" });
  }
  if (typeof sig.gap_theme === "string" || sig.from_manager_feedback === true || /manager|calibration/i.test(JSON.stringify(sig))) {
    if (!out.some((t) => t.key === "role_sig")) {
      out.push({ key: "cal", label: "Calibration" });
    }
  }

  switch (item.source) {
    case "career":
      if (!out.some((t) => t.label === "From career")) {
        out.push({ key: "src_career", label: "From career" });
      }
      break;
    case "gap":
      if (!out.some((t) => t.label === "From gap")) {
        out.push({ key: "src_gap", label: "From gap" });
      }
      break;
    case "role":
      out.push({ key: "src_role", label: "From role" });
      break;
    case "application":
      out.push({ key: "app", label: "From application" });
      break;
    case "manual":
      out.push({ key: "man", label: "Manual" });
      break;
    default:
      break;
  }

  const seen = new Set<string>();
  return out.filter((t) => {
    if (seen.has(t.label)) return false;
    seen.add(t.label);
    return true;
  });
}

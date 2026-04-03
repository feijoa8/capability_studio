/** DB column `status` on competency_practices, competency_subjects, competencies */
export type CompetencyLifecycleStatus =
  | "active"
  | "deprecated"
  | "archived";

export type LifecycleViewFilter = "all" | "active" | "deprecated" | "archived";

export function parseLifecycleStatus(
  v: string | null | undefined
): CompetencyLifecycleStatus {
  if (v === "deprecated" || v === "archived") return v;
  return "active";
}

/** Client-side filter for management lists (showArchived controls archived visibility when filter is "all"). */
export function entityMatchesLifecycleFilter(
  status: string | null | undefined,
  filter: LifecycleViewFilter,
  showArchived: boolean
): boolean {
  const s = parseLifecycleStatus(status);
  if (filter === "active") return s === "active";
  if (filter === "deprecated") return s === "deprecated";
  if (filter === "archived") return s === "archived";
  if (!showArchived) return s !== "archived";
  return true;
}

/** Only active rows can be chosen in assignment / create dropdowns. */
export function isAssignableLifecycleStatus(
  status: string | null | undefined
): boolean {
  return parseLifecycleStatus(status) === "active";
}

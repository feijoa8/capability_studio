/**
 * Non-AI placeholder: infer interest in leadership-style growth from target role text.
 */

const KEYWORDS = [
  "programme",
  "portfolio",
  "director",
  "manager",
  "lead",
] as const;

export type DevelopmentFocusItem = {
  id: string;
  title: string;
  explanation: string;
};

/** Fixed catalogue shown when a keyword signal is present in next/future role. */
const FOCUS_CATALOG: DevelopmentFocusItem[] = [
  {
    id: "programme-delivery-leadership",
    title: "Programme delivery leadership",
    explanation:
      "Shape outcomes across workstreams, manage dependencies, and keep delivery aligned to intent.",
  },
  {
    id: "strategic-stakeholder-management",
    title: "Strategic stakeholder management",
    explanation:
      "Build trust with senior sponsors, align expectations, and navigate competing priorities.",
  },
  {
    id: "financial-governance-exposure",
    title: "Financial / governance exposure",
    explanation:
      "Grow comfort with budgets, business cases, risk registers, and accountable decision-making.",
  },
  {
    id: "cross-functional-leadership",
    title: "Cross-functional leadership",
    explanation:
      "Influence without authority and orchestrate teams across disciplines.",
  },
  {
    id: "operational-planning-prioritisation",
    title: "Operational planning and prioritisation",
    explanation:
      "Translate strategy into roadmaps, capacity trade-offs, and measurable milestones.",
  },
];

export function hasCareerKeywordSignal(
  nextRole: string,
  futureRole: string
): boolean {
  const hay = `${nextRole} ${futureRole}`.toLowerCase();
  return KEYWORDS.some((k) => hay.includes(k));
}

/** Returns the predefined list when keywords match; otherwise empty. */
export function getSuggestedDevelopmentFocus(
  nextRole: string,
  futureRole: string
): DevelopmentFocusItem[] {
  if (!hasCareerKeywordSignal(nextRole, futureRole)) return [];
  return FOCUS_CATALOG;
}

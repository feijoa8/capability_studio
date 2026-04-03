/**
 * Placeholder “suggestions” for development goals (no AI / network).
 */
export function getMockSuggestions(competencyName: string): string[] {
  const label = competencyName.trim() || "this competency";
  return [
    `Block 30–60 minutes this week to practise ${label} in a low-risk context.`,
    `Pair with someone stronger in ${label} and walk through one real example together.`,
    `Find one short resource (article, video, or module) on ${label} and note two takeaways.`,
    `Apply ${label} to a small deliverable and reflect on what worked and what to repeat.`,
    `Share your plan to improve ${label} with your manager and agree a check-in date.`,
  ];
}

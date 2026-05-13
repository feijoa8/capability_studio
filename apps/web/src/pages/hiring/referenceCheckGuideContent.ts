/**
 * Fixed reference-conversation prompts — copy-first, no persistence or scoring.
 */

export type ReferenceCheckSection = {
  id: string;
  title: string;
  questions: string[];
};

export const REFERENCE_CHECK_INTRO =
  "Use this as a structured guide for a reference conversation or written follow-up. Copy what you need and complete it in your own notes or system — nothing is stored here.";

export const REFERENCE_CHECK_SECTIONS: ReferenceCheckSection[] = [
  {
    id: "role_fit",
    title: "Role fit",
    questions: [
      "Can you describe how the candidate performed in responsibilities comparable to this role?",
      "From what you observed, how well did their skills and experience line up with the demands of the work?",
    ],
  },
  {
    id: "working_style",
    title: "Working style / collaboration",
    questions: [
      "How did they typically collaborate with managers, peers, and other stakeholders?",
      "How did they respond to feedback or navigate disagreement in a team setting?",
    ],
  },
  {
    id: "reliability",
    title: "Reliability / delivery",
    questions: [
      "How reliably did they follow through on commitments and deadlines?",
      "How did they handle ambiguity, changing priorities, or delivery pressure?",
    ],
  },
  {
    id: "risks",
    title: "Risks / concerns",
    questions: [
      "What were their strongest contributions to the team or outcomes you saw?",
      "Were there any development areas you think a future manager should be aware of or support?",
    ],
  },
];

export function referenceCheckSectionPlainText(section: ReferenceCheckSection): string {
  return section.questions.map((q) => `• ${q}`).join("\n");
}

export function referenceCheckGuideToPlainText(): string {
  const blocks: string[] = [REFERENCE_CHECK_INTRO, ""];
  for (const s of REFERENCE_CHECK_SECTIONS) {
    blocks.push(s.title);
    blocks.push(referenceCheckSectionPlainText(s));
    blocks.push("");
  }
  return blocks.join("\n").trim();
}

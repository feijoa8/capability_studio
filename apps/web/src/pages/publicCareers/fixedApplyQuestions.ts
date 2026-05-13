/** Fixed Phase 1 questions — keys stored in application_answers JSON. */

export const FIXED_APPLY_QUESTION_KEYS = {
  interest: "why_interested",
  experience: "relevant_experience",
  availability: "availability_situation",
} as const;

export const FIXED_APPLY_QUESTIONS: {
  key: string;
  label: string;
  placeholder: string;
}[] = [
  {
    key: FIXED_APPLY_QUESTION_KEYS.interest,
    label: "Why are you interested in this role?",
    placeholder: "A few sentences is enough.",
  },
  {
    key: FIXED_APPLY_QUESTION_KEYS.experience,
    label: "What relevant experience would you highlight?",
    placeholder: "Focus on what matters for this role.",
  },
  {
    key: FIXED_APPLY_QUESTION_KEYS.availability,
    label: "What is your availability / current situation?",
    placeholder: "e.g. notice period, part-time, start timeframe.",
  },
];

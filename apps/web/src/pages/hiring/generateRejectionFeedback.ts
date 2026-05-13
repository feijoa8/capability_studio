import type { SupabaseClient } from "@supabase/supabase-js";
import type { HiringApplicationStage } from "./hiringApi";

/** Inputs for AI-assisted rejection copy (no persistence). */
export type GenerateRejectionFeedbackInput = {
  stage: HiringApplicationStage;
  /** True when evaluation summary or strength/gap lines exist — richer signal for strengths / areas to develop. */
  hasEvaluationSignals: boolean;
  /**
   * True when the candidate likely reached interview (or equivalent) before rejection.
   * Gated separately from hasEvaluationSignals so early reviewed candidates are not given interview wording.
   */
  reachedInterviewStage: boolean;
  evaluationSummary: string | null;
  strengths: string[];
  gaps: string[];
  jobProfileRequirements: string[];
  roleTitle?: string | null;
};

/**
 * Calls the edge function to draft 3–5 sentences of constructive rejection feedback.
 * Does not persist; populate a textarea with the returned text.
 */
export async function generateRejectionFeedback(
  client: SupabaseClient,
  input: GenerateRejectionFeedbackInput,
): Promise<{ text: string } | { error: string }> {
  const { data, error } = await client.functions.invoke("generate-rejection-feedback", {
    body: {
      stage: input.stage,
      hasEvaluationSignals: input.hasEvaluationSignals,
      reachedInterviewStage: input.reachedInterviewStage,
      evaluationSummary: input.evaluationSummary,
      strengths: input.strengths,
      gaps: input.gaps,
      jobProfileRequirements: input.jobProfileRequirements,
      roleTitle: input.roleTitle ?? null,
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data && typeof data === "object" && data !== null && "feedback" in data) {
    const t = String((data as { feedback?: unknown }).feedback ?? "").trim();
    if (t) {
      return { text: t };
    }
  }

  return { error: "No suggestion returned." };
}

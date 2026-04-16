import { supabase } from "../../../lib/supabase";
import type { RefinementContext, RefinementSuggestionPayload } from "./types";

type InvokeResponse = {
  error?: string;
  suggestion?: RefinementSuggestionPayload;
};

/**
 * Calls the `refine-evidence` edge function with a bounded {@link RefinementContext}.
 */
export async function requestRefineEvidence(
  context: RefinementContext,
): Promise<RefinementSuggestionPayload> {
  const { data, error } = await supabase.functions.invoke("refine-evidence", {
    body: { context },
  });

  if (error) {
    throw new Error(error.message ?? "Refinement request failed.");
  }

  const payload = data as InvokeResponse | null;
  if (payload?.error) {
    throw new Error(payload.error);
  }
  if (!payload?.suggestion) {
    throw new Error("No suggestion returned from refinement service.");
  }

  return payload.suggestion;
}

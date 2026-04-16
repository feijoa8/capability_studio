import { supabase } from "../../../lib/supabase";
import type { CareerFocusSuggestionPayload, CareerRefinementContext } from "./types";

type InvokeResponse = {
  error?: string;
  suggestion?: CareerFocusSuggestionPayload;
};

export async function requestRefineCareer(
  context: CareerRefinementContext,
): Promise<CareerFocusSuggestionPayload> {
  const { data, error } = await supabase.functions.invoke("refine-career", {
    body: { context },
  });

  if (error) {
    throw new Error(error.message ?? "Career refinement request failed.");
  }

  const payload = data as InvokeResponse | null;
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.suggestion) {
    throw new Error("No suggestion returned from career coach service.");
  }
  return payload.suggestion;
}


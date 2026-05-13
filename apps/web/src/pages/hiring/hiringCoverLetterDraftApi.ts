import type { SupabaseClient } from "@supabase/supabase-js";

export type HiringCoverLetterDraftResult =
  | { ok: true; draft: string }
  | { ok: false; error: string };

/**
 * Fills the editable textarea only; does not persist. Uses `generate-hiring-cover-letter-draft` edge function.
 */
export async function requestHiringCoverLetterDraft(
  client: SupabaseClient,
  openingId: string,
): Promise<HiringCoverLetterDraftResult> {
  const { data, error } = await client.functions.invoke(
    "generate-hiring-cover-letter-draft",
    {
      body: { opening_id: openingId },
    },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  const raw = data as { draft?: unknown; error?: unknown } | null;
  if (raw && typeof raw === "object" && typeof raw.error === "string") {
    return { ok: false, error: raw.error };
  }
  const draft =
    typeof raw?.draft === "string" ? raw.draft.trim() : "";
  if (!draft) {
    return { ok: false, error: "No draft text was returned." };
  }
  return { ok: true, draft };
}

import type { HiringApplicationRow } from "./hiringApi";

/**
 * Best-effort signal: candidate likely reached at least one interview (or equivalent live step)
 * before rejection. Used only for AI prompt gating — not stored.
 * Defaults false when unclear (safer for early-stage wording).
 */
export function inferReachedInterviewStage(row: HiringApplicationRow): boolean {
  const chunks: string[] = [];
  const es = row.evaluation_summary?.trim();
  if (es) chunks.push(es);
  chunks.push(JSON.stringify(row.evaluation_snapshot ?? {}));
  const notes = typeof row.notes === "string" ? row.notes : "";
  if (notes.trim()) chunks.push(notes);

  const text = chunks.join("\n").toLowerCase();

  if (
    /(did not|without|no|never)\s+.{0,48}\binterview|not\s+interviewed|prior to (any )?interview|before (any )?interview|without (an )?interview/i.test(
      text,
    )
  ) {
    return false;
  }

  return /\binterview(s|ed|ing)?\b|\bphone screen\b|\bvideo (call|interview)\b|\bpanel\b|\bon-?site\b|\bassessment (day|center|centre)\b|\bmet with (the )?(team|panel|interviewers)\b|\bconversation(s)? with (the )?(panel|team|interviewers)\b/i.test(
    text,
  );
}

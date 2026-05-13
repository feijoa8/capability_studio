/**
 * Presentation helpers for rejection feedback (modal display + future email wrapping).
 * Does not persist or send email.
 */

/** Split on sentence boundaries (Latin punctuation + following space). */
function splitIntoSentences(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [t];
}

/**
 * Prefer explicit `\n\n` blocks; otherwise group sentences (~2 per paragraph) for readable layout.
 */
export function paragraphBlocksFromText(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const explicit = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (explicit.length > 1) {
    return explicit.slice(0, 8);
  }

  const sentences = splitIntoSentences(explicit[0] ?? trimmed);
  if (sentences.length <= 1) return [sentences[0] ?? trimmed];

  const blocks: string[] = [];
  let i = 0;
  while (i < sentences.length && blocks.length < 4) {
    const take = Math.min(2, sentences.length - i);
    const chunk = sentences.slice(i, i + take).join(" ");
    blocks.push(chunk);
    i += take;
  }
  if (i < sentences.length) {
    const rest = sentences.slice(i).join(" ");
    if (rest) blocks.push(rest);
  }
  return blocks;
}

// --- Email wrapper (future sending; not used in AI output) ---

export function buildRejectionEmailGreeting(candidateFirstName: string): string {
  const fn = candidateFirstName.trim();
  return `Hi ${fn || "there"},`;
}

export function buildRejectionEmailClosing(companyName: string): string {
  const c = companyName.trim() || "Our";
  return `Kind regards,\n${c} Hiring Team`;
}

/** Full email body: greeting + feedback + closing (no sending). */
export function wrapRejectionFeedbackForEmail(args: {
  feedbackBody: string;
  candidateFirstName: string;
  companyName: string;
}): string {
  const body = args.feedbackBody.trim();
  const g = buildRejectionEmailGreeting(args.candidateFirstName);
  const c = buildRejectionEmailClosing(args.companyName);
  return `${g}\n\n${body}\n\n${c}`;
}

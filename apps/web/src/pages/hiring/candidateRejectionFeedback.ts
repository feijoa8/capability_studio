import type { HiringApplicationRow } from "./hiringApi";
import { parseEvaluationSnapshot } from "./hiringEvaluationDisplay";

export type RejectionFeedbackBundle = {
  strengthsToAcknowledge: string[];
  developmentFeedback: string[];
  candidateMessage: string;
};

const MAX_EMBED = 72;

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trim() + "…";
}

function variantIndex(seed: string, salt: number): number {
  let h = salt * 17;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 4;
}

function strengthAckLine(raw: string, index: number): string {
  const s = clip(raw, MAX_EMBED);
  const v = variantIndex(raw, index);
  switch (v) {
    case 0:
      return `Demonstrated meaningful strength in ${s} — worth acknowledging explicitly in your note.`;
    case 1:
      return `Strong signal around ${s}; a genuine asset to reflect back to the candidate.`;
    case 2:
      return `The evaluation highlights solid capability in ${s}.`;
    default:
      return `Your notes point to notable depth in ${s} — appropriate to recognise warmly.`;
  }
}

function developmentLine(raw: string, index: number): string {
  const g = clip(raw, MAX_EMBED);
  const v = variantIndex(g, index + 11);
  switch (v) {
    case 0:
      return `Could further strengthen experience in ${g} — frame as a growth area, not a verdict.`;
    case 1:
      return `Building more depth in ${g} would strengthen how this profile compares to similar briefs over time.`;
    case 2:
      return `Optional encouragement: continued learning in ${g} often helps future applications in this space.`;
    default:
      return `If you offer a suggestion, keep it light: ${g} is an area where extra practice commonly helps.`;
  }
}

function takeStrengthAcknowledgements(
  strengths: string[],
  evaluationSummary: string | null | undefined,
): string[] {
  const summary = evaluationSummary?.trim();
  if (strengths.length === 0) {
    if (summary) {
      return [
        "Thoughtful engagement with the process — worth recognising even when the outcome is a no.",
        `Review your evaluation summary for authentic positives to echo (paraphrase, don’t paste): ${clip(summary, 140)}`,
      ];
    }
    return [
      "Thoughtful engagement with the process — worth recognising even when the outcome is a no.",
      "Professional interest and the time invested deserve a sincere thank-you in your own words.",
    ];
  }
  if (strengths.length === 1) {
    return [
      strengthAckLine(strengths[0], 0),
      "Pair this with thanks for their time and interest when you close the loop.",
    ];
  }
  const n = Math.min(3, strengths.length);
  return strengths.slice(0, n).map((s, i) => strengthAckLine(s, i));
}

function takeDevelopmentFeedback(
  gaps: string[],
  evaluationSummary: string | null | undefined,
): string[] {
  if (gaps.length === 0) {
    const out = [
      "If you share ideas, keep them optional and forward-looking — avoid language that sounds like a formal assessment.",
      "Stay high-level: focus on capabilities valued in similar roles rather than personal criticism.",
    ];
    const summary = evaluationSummary?.trim();
    if (summary) {
      out.push(
        `Cross-check any tip with the tone of your saved summary so feedback stays consistent: ${clip(summary, 100)}…`,
      );
    }
    return out;
  }
  if (gaps.length === 1) {
    return [
      developmentLine(gaps[0], 0),
      "Keep suggestions constructive and easy to ignore if the candidate prefers not to receive coaching.",
    ];
  }
  const n = Math.min(3, gaps.length);
  return gaps.slice(0, n).map((g, i) => developmentLine(g, i));
}

function buildCandidateMessage(strengths: string[], gaps: string[]): string {
  const softS = strengths.slice(0, 2).map((s) => clip(s, 56)).filter(Boolean);
  const softG = gaps.slice(0, 1).map((g) => clip(g, 52)).filter(Boolean);

  const lines: string[] = [];
  lines.push("Thank you for your time and interest in this opportunity.");
  lines.push("");
  lines.push(
    "I'm writing to let you know that we won't be moving forward with your application on this occasion.",
  );

  if (softS.length > 0) {
    lines.push("");
    if (softS.length === 1) {
      lines.push(
        `We genuinely appreciated what you brought, particularly in relation to ${softS[0]}.`,
      );
    } else {
      lines.push(
        `We genuinely appreciated strengths you demonstrated, including ${softS[0]} and ${softS[1]}.`,
      );
    }
  } else {
    lines.push("");
    lines.push("We appreciated learning about your background and your interest in the role.");
  }

  if (softG.length > 0) {
    lines.push("");
    lines.push(
      `If it's useful, many people find that continuing to build experience in ${softG[0]} can help strengthen future applications for similar roles. Please take this only as general encouragement.`,
    );
  } else {
    lines.push("");
    lines.push(
      "We hope you'll keep developing the capabilities that matter to your goals, and we wish you well in what comes next.",
    );
  }

  lines.push("");
  lines.push("Thank you again, and all the best in your search.");

  return lines.join("\n");
}

/**
 * Deterministic, copy-first drafts from saved evaluation fields only.
 * Nothing is stored; callers should treat this as guidance for manual use.
 */
export function buildRejectionFeedbackBundle(row: HiringApplicationRow): RejectionFeedbackBundle {
  const snap = parseEvaluationSnapshot(row.evaluation_snapshot);
  const strengths = snap.strengths ?? [];
  const gaps = snap.gaps ?? [];
  const summary = row.evaluation_summary;

  return {
    strengthsToAcknowledge: takeStrengthAcknowledgements(strengths, summary),
    developmentFeedback: takeDevelopmentFeedback(gaps, summary),
    candidateMessage: buildCandidateMessage(strengths, gaps),
  };
}

export function rejectionFeedbackToPlainText(b: RejectionFeedbackBundle): string {
  const blocks: string[] = [];
  blocks.push("Strengths to acknowledge");
  for (const s of b.strengthsToAcknowledge) {
    blocks.push(`• ${s}`);
  }
  blocks.push("");
  blocks.push("Development feedback");
  for (const s of b.developmentFeedback) {
    blocks.push(`• ${s}`);
  }
  blocks.push("");
  blocks.push("Suggested candidate message");
  blocks.push(b.candidateMessage);
  return blocks.join("\n");
}

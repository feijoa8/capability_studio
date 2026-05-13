import type { HiringApplicationRow, HiringApplicationStage } from "./hiringApi";
import type { HiringEvaluationBand } from "./hiringEvaluationDisplay";
import { resolveFitIndicator } from "./hiringEvaluationDisplay";

/**
 * Phase 1 recommended actions — guidance only, derived at render time from
 * stage + saved evaluation. No automation, tasks, or external integrations.
 */
export type RecommendedActionId =
  | "book_interview"
  | "request_referees"
  | "conduct_reference_check"
  | "criminal_check"
  | "prepare_offer"
  | "reject_candidate"
  | "hold_review"
  | "provide_feedback_notify";

export type RecommendedAction = {
  id: RecommendedActionId;
  label: string;
  explanation: string;
  /** Shown for book_interview only — placeholder for future interview-guide / scheduling work. */
  foundationNote?: string;
};

const DEFS: Record<
  RecommendedActionId,
  Omit<RecommendedAction, "id"> & { foundationNote?: string }
> = {
  book_interview: {
    label: "Book interview",
    explanation:
      "Schedule a structured conversation with this candidate using your organisation’s normal booking process. This is the operational next step when fit looks good — use Interview preparation on this panel to review targeted questions before the conversation.",
    foundationNote:
      "Calendar integration is not wired in here; Capability Studio does not send invites.",
  },
  request_referees: {
    label: "Request referees",
    explanation:
      "Ask the candidate for referee details you can follow up on outside this app. Use the guided copy — nothing is sent from Capability Studio.",
  },
  conduct_reference_check: {
    label: "Conduct reference check",
    explanation:
      "Use the structured question guide when you speak with referees. Copy prompts into your own notes or call script — no scoring or storage here.",
  },
  criminal_check: {
    label: "Run criminal record check",
    explanation:
      "If your organisation requires a criminal record or other vetting step before hire, run it through your approved process. Capability Studio does not submit checks on your behalf.",
  },
  prepare_offer: {
    label: "Prepare offer",
    explanation:
      "Draft compensation, start date, and terms using your standard templates and approvals. Nothing is sent from this app.",
  },
  reject_candidate: {
    label: "Reject candidate",
    explanation:
      "Given current fit and stage, closing this candidacy may be appropriate. Move the card to Rejected when you have decided — or re-evaluate if new information appears.",
  },
  hold_review: {
    label: "Hold / review later",
    explanation:
      "Pause before the next step: gather more signal, align with the hiring manager, or wait for capacity. Revisit when ready.",
  },
  provide_feedback_notify: {
    label: "Provide feedback & notify candidate",
    explanation:
      "Use structured drafts to acknowledge strengths, share constructive development ideas, and prepare a respectful message. Copy everything manually — email and notifications are not sent from Capability Studio.",
  },
};

function uniq(ids: RecommendedActionId[]): RecommendedActionId[] {
  return [...new Set(ids)];
}

function toActions(ids: RecommendedActionId[]): RecommendedAction[] {
  return ids.slice(0, 3).map((id) => ({
    id,
    label: DEFS[id].label,
    explanation: DEFS[id].explanation,
    ...(id === "book_interview" && DEFS.book_interview.foundationNote
      ? { foundationNote: DEFS.book_interview.foundationNote }
      : {}),
  }));
}

/**
 * Deterministic rules from stage + evaluation band (from persisted score/band).
 * Returns [] when no saved evaluation, terminal stages, or unknown fit.
 */
export function deriveRecommendedActions(
  row: HiringApplicationRow,
): RecommendedAction[] {
  const stage = row.stage as HiringApplicationStage;
  if (stage === "hired") {
    return [];
  }
  if (stage === "withdrawn") {
    return [];
  }
  if (stage === "rejected") {
    return [];
  }
  if (!row.evaluation_updated_at) {
    return [];
  }

  const fit = resolveFitIndicator(row);
  const band: HiringEvaluationBand | null = fit.band;
  if (band == null) {
    return [];
  }

  let ids: RecommendedActionId[] = [];

  switch (stage) {
    case "applied":
      if (band === "strong") {
        ids = ["book_interview", "hold_review"];
      } else if (band === "moderate") {
        ids = ["hold_review", "book_interview"];
      } else {
        ids = ["reject_candidate"];
      }
      break;
    case "reviewed":
    case "shortlisted":
      if (band === "strong") {
        ids = ["book_interview"];
      } else if (band === "moderate") {
        ids = ["book_interview", "hold_review"];
      } else {
        ids = ["reject_candidate"];
      }
      break;
    case "interview":
      if (band === "strong" || band === "moderate") {
        ids = ["request_referees", "conduct_reference_check"];
      } else {
        ids = ["reject_candidate", "hold_review"];
      }
      break;
    case "offer":
      if (band === "strong" || band === "moderate") {
        ids = ["conduct_reference_check", "prepare_offer", "criminal_check"];
      } else {
        ids = ["conduct_reference_check", "prepare_offer", "hold_review"];
      }
      break;
    default:
      ids = [];
  }

  return toActions(uniq(ids));
}

/** One-line hint for collapsed card (first recommendation label, if any). */
export function firstRecommendedLabel(row: HiringApplicationRow): string | null {
  const a = deriveRecommendedActions(row);
  return a[0]?.label ?? null;
}

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  border,
  btnGhost,
  btnPrimary,
  errorColor,
  fieldBg,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import type { GenerateRejectionFeedbackInput } from "./generateRejectionFeedback";
import { generateRejectionFeedback } from "./generateRejectionFeedback";
import { paragraphBlocksFromText } from "./rejectionFeedbackFormat";
import { sendCandidateOutcome } from "./hiringApi";

type Props = {
  open: boolean;
  onClose: () => void;
  client: SupabaseClient;
  applicationId: string | null;
  /** CV extract JSON for AI development suggestions (optional). */
  cvExtractSnapshot?: Record<string, unknown> | null;
  /** Context for “Generate suggestion” (evaluation + role requirements). */
  feedbackGeneration: GenerateRejectionFeedbackInput | null;
  onSent: () => void;
};

export function RejectCandidateModal({
  open,
  onClose,
  client,
  applicationId,
  cvExtractSnapshot,
  feedbackGeneration,
  onSent,
}: Props) {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFeedback("");
    setError(null);
    setSubmitting(false);
    setGenerating(false);
    setGenerateError(null);
  }, [open, applicationId]);

  const handleGenerate = useCallback(async () => {
    if (!feedbackGeneration) return;
    if (feedback.trim()) {
      if (
        !window.confirm("Replace existing feedback with a generated suggestion?")
      ) {
        return;
      }
    }
    setGenerating(true);
    setGenerateError(null);
    const result = await generateRejectionFeedback(client, feedbackGeneration);
    setGenerating(false);
    if ("error" in result) {
      setGenerateError(result.error);
      return;
    }
    setFeedback(result.text);
  }, [client, feedback, feedbackGeneration]);

  const handleSubmit = useCallback(async () => {
    if (!applicationId) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await sendCandidateOutcome(
      client,
      applicationId,
      feedback,
      { cvExtractSnapshot: cvExtractSnapshot ?? null },
    );
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onSent();
    onClose();
  }, [applicationId, client, cvExtractSnapshot, feedback, onClose, onSent]);

  if (!open || !applicationId) return null;

  const canGenerate = Boolean(feedbackGeneration) && !submitting;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="reject-outcome-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 97,
        padding: 16,
      }}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "min(88vh, 640px)",
          overflowY: "auto",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "20px 22px",
          boxSizing: "border-box",
        }}
      >
        <h2
          id="reject-outcome-title"
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Provide feedback & notify candidate
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
          This message is shown to the candidate and triggers their in-app outcome notification.
          The application stays in Rejected on your board.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <label
            htmlFor="reject-outcome-feedback"
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: mutedColor,
              margin: 0,
            }}
          >
            Feedback <span style={{ color: errorColor }}>*</span>
          </label>
          <button
            type="button"
            style={{
              ...btnGhost,
              fontSize: 12,
              padding: "5px 10px",
              opacity: canGenerate && !generating ? 1 : 0.55,
            }}
            disabled={!canGenerate || generating}
            title={
              feedbackGeneration
                ? "Draft a suggestion with AI (edit before sending)"
                : "Context unavailable for generation"
            }
            onClick={() => void handleGenerate()}
          >
            {generating ? "Generating…" : "Generate suggestion"}
          </button>
        </div>
        {generateError ? (
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              color: "#c98a8a",
              lineHeight: 1.35,
            }}
          >
            {generateError}
          </p>
        ) : null}
        <textarea
          id="reject-outcome-feedback"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={8}
          required
          disabled={generating}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${border}`,
            background: fieldBg,
            color: text,
            fontSize: 14,
            lineHeight: 1.55,
            resize: "vertical",
            minHeight: 140,
            fontFamily: "inherit",
            opacity: generating ? 0.85 : 1,
            whiteSpace: "pre-wrap",
          }}
          placeholder={
            "Share constructive feedback. Use blank lines between paragraphs for clearer reading."
          }
        />
        {feedback.trim() ? (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: "rgba(12, 15, 20, 0.65)",
            }}
          >
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: mutedColor,
              }}
            >
              Preview (as sent to candidate)
            </p>
            <div style={{ fontSize: 14, color: text, lineHeight: 1.55 }}>
              {paragraphBlocksFromText(feedback).map((block, i) => (
                <p
                  key={`fb-prev-${i}`}
                  style={{
                    margin: i > 0 ? "10px 0 0" : 0,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {block}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        {error ? (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: errorColor }}>{error}</p>
        ) : null}
        <div
          style={{
            marginTop: 18,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            style={btnGhost}
            onClick={onClose}
            disabled={submitting || generating}
          >
            Cancel
          </button>
          <button
            type="button"
            style={btnPrimary}
            onClick={() => void handleSubmit()}
            disabled={submitting || generating || !feedback.trim()}
          >
            {submitting ? "Sending…" : "Send outcome"}
          </button>
        </div>
      </div>
    </div>
  );
}

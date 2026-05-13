/**
 * Modal-level loading only (`loading` state here). Does not set parent page `loading` / `sectionRefreshing`.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  border,
  btnGhost,
  btnPrimary,
  fieldBg,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import type { HiringApplicationStage } from "./hiringApi";
import { computeSignalFit } from "./evaluateCandidateFit";
import { fetchCandidateSignals, fetchJobSignals } from "./evaluationData";
import { scoreToEvaluationBand } from "./hiringEvaluationDisplay";

type Props = {
  open: boolean;
  organisationId: string;
  jobProfileId: string | null;
  candidateUserId: string | null;
  candidateName: string;
  /** When set, evaluation result is written to this hiring_applications row. */
  applicationId?: string | null;
  /** Application CV extract (external apply); merged into hiring fit signals. */
  cvExtractSnapshot?: Record<string, unknown> | null;
  /** Current pipeline stage — drives decision button enabled state. */
  currentStage?: HiringApplicationStage | null;
  onEvaluationSaved?: () => void;
  /** Move application to shortlisted; parent closes modal on success. */
  onShortlist?: () => Promise<void>;
  /** Move application to rejected; parent closes modal on success. */
  onReject?: () => Promise<void>;
  onClose: () => void;
};

function scoreColor(score: number): string {
  if (score >= 70) return "#9fd4b8";
  if (score >= 40) return "#e8c96a";
  return "#c4c8d4";
}

const btnRejectOutline: CSSProperties = {
  ...btnGhost,
  borderColor: "rgba(232, 120, 120, 0.4)",
  color: "#e8a0a0",
};

export function EvaluateCandidateModal({
  open,
  organisationId,
  jobProfileId,
  candidateUserId,
  candidateName,
  applicationId,
  cvExtractSnapshot = null,
  currentStage = null,
  onEvaluationSaved,
  onShortlist,
  onReject,
  onClose,
}: Props) {
  void organisationId;
  const onEvaluationSavedRef = useRef(onEvaluationSaved);
  onEvaluationSavedRef.current = onEvaluationSaved;
  const [loading, setLoading] = useState(false);
  const [limitedProfileBanner, setLimitedProfileBanner] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [summary, setSummary] = useState<string>("");
  const [strengths, setStrengths] = useState<string[]>([]);
  const [partialCoverage, setPartialCoverage] = useState<string[]>([]);
  const [gaps, setGaps] = useState<string[]>([]);
  const [jobSignalCount, setJobSignalCount] = useState(0);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [evaluationSaveError, setEvaluationSaveError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setLimitedProfileBanner(false);
      setScore(null);
      setSummary("");
      setStrengths([]);
      setPartialCoverage([]);
      setGaps([]);
      setJobSignalCount(0);
      setDecisionBusy(false);
      setEvaluationSaveError(null);
      return;
    }
    if (!jobProfileId || !candidateUserId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLimitedProfileBanner(false);
    setEvaluationSaveError(null);

    void (async () => {
      const [job, candidate] = await Promise.all([
        fetchJobSignals(supabase, jobProfileId),
        fetchCandidateSignals(supabase, candidateUserId, {
          cvExtractSnapshot,
        }),
      ]);

      if (cancelled) return;

      setLimitedProfileBanner(candidate.rawSignals.length === 0);

      const result = computeSignalFit(
        { rawSignals: job.rawSignals, families: job.families },
        {
          rawSignals: candidate.rawSignals,
          familiesStrict: candidate.familiesStrict,
          familiesLoose: candidate.familiesLoose,
        },
      );
      setScore(result.score);
      setSummary(result.summary);
      setStrengths(result.strengths);
      setPartialCoverage(result.partialCoverage);
      setGaps(result.gaps);
      setJobSignalCount(result.jobSignalCount);

      if (!cancelled && applicationId) {
        const noJobSignals = result.jobSignalCount === 0;
        const { error: saveErr } = await supabase
          .from("hiring_applications")
          .update({
            evaluation_score: noJobSignals ? null : result.score,
            evaluation_band: noJobSignals ? null : scoreToEvaluationBand(result.score),
            evaluation_summary: result.summary,
            evaluation_snapshot: {
              strengths: result.strengths,
              partialCoverage: result.partialCoverage,
              gaps: result.gaps,
              overlapCount: result.overlapCount,
              jobSignalCount: result.jobSignalCount,
            },
            evaluation_updated_at: new Date().toISOString(),
          })
          .eq("id", applicationId);
        if (saveErr) {
          console.warn("hiring_applications evaluation save:", saveErr.message);
          if (!cancelled) {
            setEvaluationSaveError(
              saveErr.message ||
                "Could not save evaluation to this application (check permissions).",
            );
          }
        } else {
          onEvaluationSavedRef.current?.();
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, jobProfileId, candidateUserId, applicationId, cvExtractSnapshot]);

  const showDecisions =
    Boolean(applicationId) &&
    currentStage != null &&
    typeof onShortlist === "function" &&
    typeof onReject === "function";

  const atShortlist = currentStage === "shortlisted";
  const atRejected = currentStage === "rejected";

  async function handleShortlist() {
    if (!onShortlist || decisionBusy) return;
    setDecisionBusy(true);
    try {
      await onShortlist();
    } finally {
      setDecisionBusy(false);
    }
  }

  async function handleReject() {
    if (!onReject || decisionBusy) return;
    setDecisionBusy(true);
    try {
      await onReject();
    } finally {
      setDecisionBusy(false);
    }
  }

  if (!open) return null;

  if (!jobProfileId) {
    return (
      <div
        role="dialog"
        aria-modal
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 90,
          padding: 16,
        }}
        onMouseDown={(ev) => {
          if (ev.target === ev.currentTarget) onClose();
        }}
      >
        <div
          style={{
            width: "min(440px, 100%)",
            backgroundColor: surface,
            border: `1px solid ${border}`,
            borderRadius: 12,
            padding: "20px 22px",
          }}
        >
          <p style={{ margin: 0, color: text, fontSize: 14 }}>
            This hiring role has no job profile linked, so evaluation is not
            available.
          </p>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button type="button" style={btnGhost} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Evaluate candidate"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
        padding: 16,
      }}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(520px, 100%)",
          maxHeight: "min(85vh, 720px)",
          overflowY: "auto",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "20px 22px",
          boxSizing: "border-box",
        }}
      >
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Evaluate candidate
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: mutedColor }}>
          {candidateName}
        </p>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: mutedColor }}>
          Concept-level fit from job profile hiring signals vs candidate evidence: My Experience
          (when present) and the structured CV extract stored on this application when the
          candidate applied with a CV.
          {applicationId
            ? " Results are saved on this application when evaluation completes."
            : " Not saved."}
        </p>

        {evaluationSaveError ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              border: `1px solid rgba(232, 120, 120, 0.45)`,
              background: "rgba(180, 60, 60, 0.12)",
              marginBottom: 16,
            }}
            role="alert"
          >
            <p style={{ margin: 0, fontSize: 14, color: "#e8a0a0", lineHeight: 1.5 }}>
              Evaluation could not be saved: {evaluationSaveError}
            </p>
          </div>
        ) : null}

        {limitedProfileBanner ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: "rgba(232, 160, 96, 0.08)",
              marginBottom: 16,
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: "#e8c090", lineHeight: 1.5 }}>
              Limited profile data available. This evaluation is based on minimal
              information.
            </p>
          </div>
        ) : null}

        {loading ? (
          <p style={{ color: mutedColor, margin: 0 }}>Loading…</p>
        ) : (
          <>
            {jobSignalCount === 0 ? (
              <p style={{ color: mutedColor, fontSize: 14, margin: "0 0 12px" }}>
                {summary}
              </p>
            ) : (
              <>
                <div
                  style={{
                    padding: "18px 20px",
                    borderRadius: 10,
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    marginBottom: 16,
                    textAlign: "center",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: mutedColor,
                    }}
                  >
                    Fit score
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 48,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: score != null ? scoreColor(score) : text,
                    }}
                  >
                    {score ?? "—"}
                    {score != null ? (
                      <span
                        style={{
                          fontSize: 22,
                          fontWeight: 600,
                          color: mutedColor,
                        }}
                      >
                        {" "}
                        / 100
                      </span>
                    ) : null}
                  </p>
                </div>

                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    border: `1px solid ${border}`,
                    background: "rgba(110, 176, 240, 0.06)",
                    marginBottom: 16,
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: mutedColor,
                    }}
                  >
                    Summary
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.55,
                    }}
                  >
                    {summary}
                  </p>
                </div>

                <div style={{ display: "grid", gap: 14 }}>
                  <section>
                    <p
                      style={{
                        margin: "0 0 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: mutedColor,
                      }}
                    >
                      Strengths
                    </p>
                    {strengths.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                        None
                      </p>
                    ) : (
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 14,
                          color: text,
                          lineHeight: 1.45,
                        }}
                      >
                        {strengths.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {partialCoverage.length > 0 ? (
                    <section>
                      <p
                        style={{
                          margin: "0 0 8px",
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: mutedColor,
                        }}
                      >
                        Partial coverage
                      </p>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 14,
                          color: text,
                          lineHeight: 1.45,
                        }}
                      >
                        {partialCoverage.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <section>
                    <p
                      style={{
                        margin: "0 0 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: mutedColor,
                      }}
                    >
                      Gaps
                    </p>
                    {gaps.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                        None within the top role signals reviewed.
                      </p>
                    ) : (
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 14,
                          color: text,
                          lineHeight: 1.45,
                        }}
                      >
                        {gaps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            )}
          </>
        )}

        {showDecisions && !loading ? (
          <div
            style={{
              marginTop: 22,
              paddingTop: 18,
              borderTop: `1px solid ${border}`,
            }}
          >
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: mutedColor,
              }}
            >
              Decision
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                style={btnPrimary}
                disabled={decisionBusy || atShortlist}
                onClick={() => void handleShortlist()}
              >
                {atShortlist ? "Already shortlisted" : "Shortlist candidate"}
              </button>
              <button
                type="button"
                style={btnRejectOutline}
                disabled={decisionBusy || atRejected}
                onClick={() => void handleReject()}
              >
                {atRejected ? "Already rejected" : "Reject candidate"}
              </button>
            </div>
          </div>
        ) : null}

        <div
          style={{
            marginTop: showDecisions && !loading ? 16 : 20,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

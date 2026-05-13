import { useCallback, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  border,
  btnGhost,
  btnPrimary,
  fieldBg,
  mutedColor,
  text,
} from "../hub/hubTheme";
import type { HiringApplicationRow, HiringApplicationStage } from "./hiringApi";
import { STAGE_LABEL } from "./hiringApi";
import {
  parseEvaluationSnapshot,
  resolveFitIndicator,
} from "./hiringEvaluationDisplay";
import {
  deriveRecommendedActions,
  type RecommendedAction,
} from "./hiringRecommendedActions";
import { CandidateFeedbackNotifyModal } from "./CandidateFeedbackNotifyModal";
import { ReferenceCheckGuideModal } from "./ReferenceCheckGuideModal";
import { RequestRefereesModal } from "./RequestRefereesModal";
import { RecommendedActionExplainerModal } from "./RecommendedActionExplainerModal";
import { TargetedInterviewQuestionsModal } from "./TargetedInterviewQuestionsModal";
import { FIXED_APPLY_QUESTIONS } from "../publicCareers/fixedApplyQuestions";
import {
  interviewSectionsToPlainText,
  loadInterviewQuestionSections,
} from "./targetedInterviewQuestions";
import { HiringViewCvLink } from "./HiringViewCvLink";

type Props = {
  row: HiringApplicationRow;
  /** Job profile for this hiring role — used to load role signals and competencies for targeted questions. */
  jobProfileId: string | null;
  onReevaluate: () => void;
  onStageChange: (stage: HiringApplicationStage) => void;
  /** True while this row’s stage update request is in flight (action-level). */
  actionLoading: boolean;
};

function formatEvalTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

/** Short labels from `import-cv-extract` JSON stored on `hiring_applications.cv_extract_snapshot`. */
function summarizeCvExtractSnapshot(
  snap: Record<string, unknown> | null | undefined,
): { workLines: string[]; projectLines: string[]; hasProfileBlurb: boolean } | null {
  if (!snap || typeof snap !== "object") return null;
  const workLines: string[] = [];
  const wx = snap.work_experience;
  if (Array.isArray(wx)) {
    for (const w of wx) {
      if (!w || typeof w !== "object" || Array.isArray(w)) continue;
      const o = w as Record<string, unknown>;
      const title = typeof o.role_title === "string" ? o.role_title.trim() : "";
      const org =
        typeof o.organisation_name === "string" ? o.organisation_name.trim() : "";
      const line = [title, org].filter(Boolean).join(" — ");
      if (line) workLines.push(line);
    }
  }
  const projectLines: string[] = [];
  const pj = snap.projects;
  if (Array.isArray(pj)) {
    for (const p of pj) {
      if (!p || typeof p !== "object" || Array.isArray(p)) continue;
      const o = p as Record<string, unknown>;
      const name = typeof o.project_name === "string" ? o.project_name.trim() : "";
      if (name) projectLines.push(name);
    }
  }
  const prof = snap.profile;
  let hasProfileBlurb = false;
  if (prof && typeof prof === "object" && !Array.isArray(prof)) {
    const pr = prof as Record<string, unknown>;
    const sum = typeof pr.summary === "string" ? pr.summary.trim() : "";
    hasProfileBlurb = sum.length > 0;
  }
  if (workLines.length === 0 && projectLines.length === 0 && !hasProfileBlurb) return null;
  return { workLines, projectLines, hasProfileBlurb };
}

export function HiringCandidateExpandPanel({
  row,
  jobProfileId,
  onReevaluate,
  onStageChange,
  actionLoading,
}: Props) {
  const snap = parseEvaluationSnapshot(row.evaluation_snapshot);
  const hasEval = Boolean(row.evaluation_updated_at);

  const fit = resolveFitIndicator(row);
  const recommended = useMemo(() => deriveRecommendedActions(row), [row]);
  const cvExtractSummary = useMemo(
    () =>
      summarizeCvExtractSnapshot(
        row.cv_extract_snapshot as Record<string, unknown> | null | undefined,
      ),
    [row.cv_extract_snapshot],
  );
  const [explainerAction, setExplainerAction] = useState<RecommendedAction | null>(
    null,
  );
  const [interviewQuestionsOpen, setInterviewQuestionsOpen] = useState(false);
  const [feedbackNotifyOpen, setFeedbackNotifyOpen] = useState(false);
  const [requestRefereesOpen, setRequestRefereesOpen] = useState(false);
  const [referenceCheckGuideOpen, setReferenceCheckGuideOpen] = useState(false);
  const [copyPrepBusy, setCopyPrepBusy] = useState(false);
  const [copyPrepHint, setCopyPrepHint] = useState<string | null>(null);

  const handleCopyInterviewQuestions = useCallback(async () => {
    setCopyPrepBusy(true);
    setCopyPrepHint(null);
    try {
      const sections = await loadInterviewQuestionSections(
        supabase,
        jobProfileId,
        row.candidate_user_id,
        row,
      );
      await navigator.clipboard.writeText(interviewSectionsToPlainText(sections));
      setCopyPrepHint("Copied to clipboard");
      window.setTimeout(() => setCopyPrepHint(null), 2200);
    } catch (e) {
      setCopyPrepHint(
        e instanceof Error ? e.message : "Could not copy questions.",
      );
      window.setTimeout(() => setCopyPrepHint(null), 4000);
    } finally {
      setCopyPrepBusy(false);
    }
  }, [jobProfileId, row]);

  return (
    <div
      style={{
        marginTop: 0,
        marginBottom: 12,
        padding: "14px 14px 16px",
        borderRadius: "0 0 8px 8px",
        border: `1px solid ${border}`,
        borderTop: `1px dashed ${border}`,
        background: "rgba(15, 23, 42, 0.65)",
        marginLeft: 0,
        marginRight: 0,
      }}
    >
      <HiringViewCvLink row={row} variant="panel" />
      <div
        style={{
          marginTop: 12,
          marginBottom: 12,
          padding: "10px 12px",
          borderRadius: 8,
          border: `1px solid ${border}`,
          background: "rgba(110, 176, 240, 0.04)",
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
          Cover letter / Supporting statement
        </p>
        {row.cover_letter_text?.trim() ? (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: text,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
            }}
          >
            {row.cover_letter_text}
          </p>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: mutedColor,
              lineHeight: 1.5,
            }}
          >
            No cover letter provided
          </p>
        )}
      </div>
      {!hasEval ? (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
          No evaluation saved yet. Use <strong style={{ color: text }}>Evaluate</strong>{" "}
          on the card or <strong style={{ color: text }}>Re-evaluate</strong> below.
        </p>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 600,
                color: text,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: fit.dotColor,
                  flexShrink: 0,
                  boxShadow: `0 0 0 2px rgba(0,0,0,0.35)`,
                }}
              />
              {fit.label}
              {row.evaluation_score != null ? (
                <span style={{ fontWeight: 500, color: mutedColor, fontSize: 12 }}>
                  ({row.evaluation_score}/100)
                </span>
              ) : null}
            </span>
          </div>

          {row.evaluation_summary ? (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: "rgba(110, 176, 240, 0.06)",
                marginBottom: 12,
              }}
            >
              <p
                style={{
                  margin: "0 0 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: mutedColor,
                }}
              >
                Summary
              </p>
              <p style={{ margin: 0, fontSize: 13, color: text, lineHeight: 1.5 }}>
                {row.evaluation_summary}
              </p>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 12 }}>
            <section>
              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: mutedColor,
                }}
              >
                Strengths
              </p>
              {!snap.strengths?.length ? (
                <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>None</p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 13,
                    color: text,
                    lineHeight: 1.45,
                  }}
                >
                  {snap.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </section>

            {snap.partialCoverage && snap.partialCoverage.length > 0 ? (
              <section>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 10,
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
                    fontSize: 13,
                    color: text,
                    lineHeight: 1.45,
                  }}
                >
                  {snap.partialCoverage.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: mutedColor,
                }}
              >
                Gaps
              </p>
              {!snap.gaps?.length ? (
                <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                  None within the saved snapshot.
                </p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 13,
                    color: text,
                    lineHeight: 1.45,
                  }}
                >
                  {snap.gaps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </section>

            {row.candidate_source === "external" &&
            row.application_answers &&
            typeof row.application_answers === "object" ? (
              <section>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Application responses
                </p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 13,
                    color: text,
                    lineHeight: 1.45,
                  }}
                >
                  {FIXED_APPLY_QUESTIONS.map((q) => {
                    const raw = (row.application_answers as Record<string, unknown>)[q.key];
                    const answerText = typeof raw === "string" ? raw.trim() : "";
                    if (!answerText) return null;
                    return (
                      <li key={q.key}>
                        <strong style={{ color: mutedColor }}>{q.label}</strong> {answerText}
                      </li>
                    );
                  })}
                </ul>
                {row.consent_accepted_at ? (
                  <p style={{ margin: "10px 0 0", fontSize: 11, color: mutedColor }}>
                    Candidate consented on{" "}
                    {formatEvalTime(row.consent_accepted_at)} — evaluation should use this
                    application package (CV extract + answers), not their full profile.
                  </p>
                ) : null}
              </section>
            ) : null}

            {cvExtractSummary ? (
              <section style={{ marginTop: 14 }}>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  CV extract (application package)
                </p>
                {cvExtractSummary.hasProfileBlurb ? (
                  <p style={{ margin: "0 0 8px", fontSize: 13, color: text, lineHeight: 1.45 }}>
                    Profile summary present in submitted CV extract.
                  </p>
                ) : null}
                {cvExtractSummary.workLines.length > 0 ? (
                  <div
                    style={{
                      marginBottom: cvExtractSummary.projectLines.length ? 8 : 0,
                    }}
                  >
                    <p style={{ margin: "0 0 4px", fontSize: 11, color: mutedColor }}>
                      Experience
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 13,
                        color: text,
                        lineHeight: 1.45,
                      }}
                    >
                      {cvExtractSummary.workLines.slice(0, 8).map((line, i) => (
                        <li key={`wx-${i}-${line.slice(0, 48)}`}>{line}</li>
                      ))}
                    </ul>
                    {cvExtractSummary.workLines.length > 8 ? (
                      <p style={{ margin: "6px 0 0", fontSize: 11, color: mutedColor }}>
                        +{cvExtractSummary.workLines.length - 8} more
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {cvExtractSummary.projectLines.length > 0 ? (
                  <div>
                    <p style={{ margin: "0 0 4px", fontSize: 11, color: mutedColor }}>
                      Projects
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 13,
                        color: text,
                        lineHeight: 1.45,
                      }}
                    >
                      {cvExtractSummary.projectLines.slice(0, 8).map((line, i) => (
                        <li key={`pj-${i}-${line.slice(0, 48)}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>

          <div style={{ marginTop: 14 }}>
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
              Interview preparation
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                style={btnPrimary}
                onClick={() => setInterviewQuestionsOpen(true)}
              >
                Review targeted interview questions
              </button>
              <button
                type="button"
                style={btnGhost}
                disabled={copyPrepBusy}
                onClick={() => void handleCopyInterviewQuestions()}
              >
                {copyPrepBusy ? "Copying…" : "Copy interview questions"}
              </button>
              {copyPrepHint ? (
                <span style={{ fontSize: 12, color: mutedColor }}>{copyPrepHint}</span>
              ) : null}
            </div>
          </div>

          {recommended.length > 0 ? (
            <div style={{ marginTop: 14 }}>
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
                Next recommended actions
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                {recommended.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      if (a.id === "provide_feedback_notify") {
                        setFeedbackNotifyOpen(true);
                      } else if (a.id === "request_referees") {
                        setRequestRefereesOpen(true);
                      } else if (a.id === "conduct_reference_check") {
                        setReferenceCheckGuideOpen(true);
                      } else {
                        setExplainerAction(a);
                      }
                    }}
                    style={{
                      padding: "6px 11px",
                      borderRadius: 999,
                      border: `1px solid ${border}`,
                      background: "rgba(110, 176, 240, 0.08)",
                      color: text,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      maxWidth: "100%",
                      textAlign: "left",
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : hasEval &&
            (row.stage === "rejected" || row.stage === "hired") ? (
            <p
              style={{
                margin: "14px 0 0",
                fontSize: 12,
                color: mutedColor,
                lineHeight: 1.45,
              }}
            >
              {row.stage === "hired"
                ? "Hired — no further recommended actions in this pipeline."
                : "Not in active pipeline — no recommended next steps."}
            </p>
          ) : null}

          <p style={{ margin: "12px 0 0", fontSize: 11, color: mutedColor }}>
            Last evaluated: {formatEvalTime(row.evaluation_updated_at ?? null)}
          </p>
        </>
      )}

      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <button type="button" style={btnPrimary} onClick={onReevaluate}>
          {hasEval ? "Re-evaluate" : "Evaluate"}
        </button>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 6,
            fontSize: 10,
            color: mutedColor,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            opacity: 0.9,
          }}
        >
          Adjust stage
          <select
            disabled={actionLoading}
            value={row.stage}
            onChange={(e) =>
              onStageChange(e.target.value as HiringApplicationStage)
            }
            style={{
              padding: "5px 8px",
              borderRadius: 6,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
              fontSize: 11,
              textTransform: "none",
              letterSpacing: "normal",
            }}
          >
            {(Object.keys(STAGE_LABEL) as HiringApplicationStage[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <RecommendedActionExplainerModal
        open={explainerAction != null}
        action={explainerAction}
        onClose={() => setExplainerAction(null)}
      />

      <TargetedInterviewQuestionsModal
        open={interviewQuestionsOpen}
        onClose={() => setInterviewQuestionsOpen(false)}
        jobProfileId={jobProfileId}
        candidateUserId={row.candidate_user_id}
        applicationRow={row}
      />

      <CandidateFeedbackNotifyModal
        open={feedbackNotifyOpen}
        onClose={() => setFeedbackNotifyOpen(false)}
        applicationRow={row}
      />

      <RequestRefereesModal
        open={requestRefereesOpen}
        onClose={() => setRequestRefereesOpen(false)}
      />

      <ReferenceCheckGuideModal
        open={referenceCheckGuideOpen}
        onClose={() => setReferenceCheckGuideOpen(false)}
      />
    </div>
  );
}

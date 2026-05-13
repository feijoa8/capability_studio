import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  border,
  btnGhost,
  btnPrimary,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import type { HiringApplicationRow } from "./hiringApi";
import {
  interviewSectionsToPlainText,
  loadInterviewQuestionSections,
  sectionToPlainText,
  type InterviewQuestionSections,
} from "./targetedInterviewQuestions";

type Props = {
  open: boolean;
  onClose: () => void;
  jobProfileId: string | null;
  candidateUserId: string;
  applicationRow: HiringApplicationRow;
};

function QuestionList({ items }: { items: string[] }) {
  return (
    <ul
      style={{
        margin: "8px 0 0",
        paddingLeft: 18,
        fontSize: 13,
        color: text,
        lineHeight: 1.5,
      }}
    >
      {items.map((q, i) => (
        <li key={`${i}-${q.slice(0, 48)}`} style={{ marginBottom: 8 }}>
          {q}
        </li>
      ))}
    </ul>
  );
}

export function TargetedInterviewQuestionsModal({
  open,
  onClose,
  jobProfileId,
  candidateUserId,
  applicationRow,
}: Props) {
  const [sections, setSections] = useState<InterviewQuestionSections | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSections(null);
      setLoadError(null);
      setCopyHint(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void loadInterviewQuestionSections(
      supabase,
      jobProfileId,
      candidateUserId,
      applicationRow,
    )
      .then((s) => {
        if (!cancelled) setSections(s);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Could not load questions.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, jobProfileId, candidateUserId, applicationRow]);

  const copyText = useCallback(async (plain: string, label: string) => {
    try {
      await navigator.clipboard.writeText(plain);
      setCopyHint(label);
      window.setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setCopyHint("Copy failed — select text manually.");
      window.setTimeout(() => setCopyHint(null), 3000);
    }
  }, []);

  const copyAll = useCallback(async () => {
    if (!sections) return;
    await copyText(interviewSectionsToPlainText(sections), "Copied all");
  }, [sections, copyText]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="tiq-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 92,
        padding: 16,
      }}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(88vh, 720px)",
          overflowY: "auto",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "20px 22px",
          boxSizing: "border-box",
        }}
      >
        <h2
          id="tiq-title"
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Targeted interview questions
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
          Generated from this role&apos;s signals, competencies, and the saved evaluation
          (strengths and gaps). Copy into your own notes or calendar invite — nothing is
          stored here.
        </p>

        {loading ? (
          <p style={{ color: mutedColor, margin: "12px 0" }}>Preparing questions…</p>
        ) : loadError ? (
          <p style={{ color: "#f0a0a0", margin: "12px 0", fontSize: 13 }}>{loadError}</p>
        ) : sections ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <button type="button" style={btnPrimary} onClick={() => void copyAll()}>
                Copy all questions
              </button>
              {copyHint ? (
                <span style={{ marginLeft: 10, fontSize: 12, color: mutedColor }}>
                  {copyHint}
                </span>
              ) : null}
            </div>

            {sections.strengthValidation.length > 0 ? (
              <section style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: mutedColor,
                    }}
                  >
                    Strength validation
                  </p>
                  <button
                    type="button"
                    style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                    onClick={() =>
                      void copyText(
                        sectionToPlainText(
                          "Strength validation",
                          sections.strengthValidation,
                        ),
                        "Copied section",
                      )
                    }
                  >
                    Copy section
                  </button>
                </div>
                <QuestionList items={sections.strengthValidation} />
              </section>
            ) : null}

            {sections.gapExploration.length > 0 ? (
              <section style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: mutedColor,
                    }}
                  >
                    Gap exploration
                  </p>
                  <button
                    type="button"
                    style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                    onClick={() =>
                      void copyText(
                        sectionToPlainText("Gap exploration", sections.gapExploration),
                        "Copied section",
                      )
                    }
                  >
                    Copy section
                  </button>
                </div>
                <QuestionList items={sections.gapExploration} />
              </section>
            ) : null}

            {sections.roleCritical.length > 0 ? (
              <section style={{ marginBottom: 18 }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: mutedColor,
                    }}
                  >
                    Role-critical scenarios
                  </p>
                  <button
                    type="button"
                    style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                    onClick={() =>
                      void copyText(
                        sectionToPlainText(
                          "Role-critical scenarios",
                          sections.roleCritical,
                        ),
                        "Copied section",
                      )
                    }
                  >
                    Copy section
                  </button>
                </div>
                <QuestionList items={sections.roleCritical} />
              </section>
            ) : null}
          </>
        ) : null}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

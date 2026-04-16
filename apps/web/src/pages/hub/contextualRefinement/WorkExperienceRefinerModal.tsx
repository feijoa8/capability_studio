import { useEffect, useMemo, useState } from "react";
import type { UserExperienceProject, UserExperienceRow } from "../types";
import { errorColor, mutedColor, text } from "../hubTheme";
import { buildWorkExperienceRefinementContext } from "./buildWorkExperienceContext";
import { ContextualRefinerShell } from "./ContextualRefinerShell";
import { RefinementDeltaPreview } from "./RefinementDeltaPreview";
import { requestRefineEvidence } from "./refineEvidenceApi";
import type { RefinementSuggestionPayload } from "./types";

export type WorkExperienceRefinerModalProps = {
  open: boolean;
  onClose: () => void;
  experience: UserExperienceRow | null;
  relatedProjects: UserExperienceProject[];
  primaryAccountType?: string | null;
  /**
   * Apply loads suggested summary and tags into the edit experience form (no auto-save).
   */
  onApplySuggestions?: (s: RefinementSuggestionPayload) => void;
};

/**
 * Refines one work experience row: loads AI suggestions from `refine-evidence`, review-only until Apply.
 */
export function WorkExperienceRefinerModal({
  open,
  onClose,
  experience,
  relatedProjects,
  primaryAccountType,
  onApplySuggestions,
}: WorkExperienceRefinerModalProps) {
  const [suggestion, setSuggestion] = useState<RefinementSuggestionPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = useMemo(() => {
    if (!experience) return null;
    return buildWorkExperienceRefinementContext({
      experience,
      relatedProjects,
      account: { primaryAccountType },
      client: "web:WorkExperienceRefinerModal",
    });
  }, [experience, relatedProjects, primaryAccountType]);

  useEffect(() => {
    if (!open || !experience || !context) {
      setSuggestion(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSuggestion(null);

    void (async () => {
      try {
        const result = await requestRefineEvidence(context);
        if (!cancelled) setSuggestion(result);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Refinement failed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, experience?.id, context]);

  if (!experience) return null;

  const contextLabel = `${experience.role_title ?? "Role"} · ${experience.organisation_name ?? "Organisation"}`;

  const applyDisabled =
    loading || !!error || !suggestion || !onApplySuggestions;

  return (
    <ContextualRefinerShell
      open={open}
      title="Refine evidence"
      subtitle="Compare what would change, then apply to the edit form. Nothing is saved until you save the experience as usual."
      contextLabel={contextLabel}
      onDismiss={onClose}
      onApply={() => {
        if (suggestion && onApplySuggestions) {
          onApplySuggestions(suggestion);
          onClose();
        }
      }}
      applyDisabled={applyDisabled}
      applyLabel="Apply suggestions to edit form"
      applyFootnote={
        <>
          Applying opens the experience editor with the model&apos;s suggested summary
          and full tag lists when provided—compare{" "}
          <strong style={{ color: text, fontWeight: 600 }}>Added</strong>,{" "}
          <strong style={{ color: text, fontWeight: 600 }}>Removed</strong>, and{" "}
          <strong style={{ color: text, fontWeight: 600 }}>unchanged</strong> below to
          see the delta; the form starts from the suggested values, which you can still
          edit. Nothing is saved until you save the experience as usual.
        </>
      }
      dismissLabel="Dismiss"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {loading ? (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: mutedColor,
              lineHeight: 1.5,
            }}
          >
            Generating suggestions…
          </p>
        ) : null}

        {error ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              backgroundColor: "rgba(220, 90, 70, 0.1)",
              border: "1px solid rgba(220, 90, 70, 0.35)",
              fontSize: 13,
              color: errorColor,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}

        {!loading && !error ? (
          <RefinementDeltaPreview
            experience={experience}
            suggestion={suggestion}
            placeholder={
              <span style={{ color: mutedColor }}>
                No suggestions returned. Try again after adding more detail to this
                role or tags.
              </span>
            }
          />
        ) : null}

        {context ? (
          <details
            style={{
              border: `1px solid rgba(255,255,255,0.08)`,
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
              }}
            >
              Inspection context (bounded JSON)
            </summary>
            <pre
              style={{
                margin: "10px 0 0",
                fontSize: 10,
                lineHeight: 1.4,
                color: text,
                overflow: "auto",
                maxHeight: 200,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(context, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </ContextualRefinerShell>
  );
}

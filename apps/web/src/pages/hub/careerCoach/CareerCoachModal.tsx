import { useEffect, useMemo, useState } from "react";
import type { CareerFocusArea, CareerFocusSuggestionPayload } from "./types";
import type { CareerRefinementContext } from "./types";
import { ContextualRefinerShell } from "../contextualRefinement/ContextualRefinerShell";
import { errorColor, mutedColor, text } from "../hubTheme";
import { requestRefineCareer } from "./refineCareerApi";
import { CareerFocusSuggestionPreview } from "./CareerFocusSuggestionPreview";

export type CareerCoachModalProps = {
  open: boolean;
  onClose: () => void;
  context: CareerRefinementContext | null;
  contextLabel: string;
  /** Applies focus areas (may persist to backlog if workspace exists) */
  onApplySuggestions?: (areas: CareerFocusArea[]) => Promise<void> | void;
  /** Whether apply will persist to a workspace backlog. */
  applyModeLabel: string;
};

export function CareerCoachModal({
  open,
  onClose,
  context,
  contextLabel,
  onApplySuggestions,
  applyModeLabel,
}: CareerCoachModalProps) {
  const [suggestion, setSuggestion] = useState<CareerFocusSuggestionPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const applyDisabled = loading || isApplying || !!error || !suggestion || !onApplySuggestions;

  const applyAreas = useMemo(() => suggestion?.focus_areas ?? [], [suggestion]);

  useEffect(() => {
    if (!open || !context) {
      setSuggestion(null);
      setError(null);
      setLoading(false);
      setIsApplying(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSuggestion(null);
    void (async () => {
      try {
        const result = await requestRefineCareer(context);
        if (!cancelled) setSuggestion(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Career coach failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, context?.meta?.requestedAt]);

  return (
    <ContextualRefinerShell
      open={open}
      title="AI Career Coach"
      subtitle="Structured focus areas grounded in your evidence — review before applying."
      contextLabel={contextLabel}
      onDismiss={onClose}
      onApply={async () => {
        if (!onApplySuggestions) return;
        if (!suggestion) return;
        setIsApplying(true);
        try {
          await onApplySuggestions(applyAreas);
          onClose();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not apply focus areas.");
        } finally {
          setIsApplying(false);
        }
      }}
      applyDisabled={applyDisabled}
      isApplying={isApplying}
      applyLabel="Apply focus areas"
      applyFootnote={
        <>
          Apply will add these focus areas to {applyModeLabel}. You can still edit
          them before saving in your normal workflow.
        </>
      }
      dismissLabel="Dismiss"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {loading ? (
          <p style={{ margin: 0, fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>
            Generating focus areas…
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
          <CareerFocusSuggestionPreview
            suggestion={suggestion}
            placeholder={
              <span style={{ color: mutedColor }}>
                No focus areas returned. Add more evidence or clarify your target
                roles and try again.
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


import type { ReactNode } from "react";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  mutedColor,
  surface,
  text,
} from "../hubTheme";

export type ContextualRefinerShellProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  /** e.g. "Work experience · Acme Ltd" */
  contextLabel: string;
  children: ReactNode;
  onDismiss: () => void;
  /** Only enable when user has reviewed AI output and chooses to merge. */
  onApply?: () => void;
  applyDisabled?: boolean;
  applyLabel?: string;
  /** Short trust copy shown above the action buttons (e.g. apply only prefills a form). */
  applyFootnote?: ReactNode;
  dismissLabel?: string;
  isApplying?: boolean;
};

/**
 * Reusable bounded shell: modal pattern with review + apply/dismiss.
 * Does not render chat history; children hold suggestion preview + optional follow-ups.
 */
export function ContextualRefinerShell({
  open,
  title,
  subtitle,
  contextLabel,
  children,
  onDismiss,
  onApply,
  applyDisabled = true,
  applyLabel = "Apply suggestions",
  applyFootnote,
  dismissLabel = "Dismiss",
  isApplying = false,
}: ContextualRefinerShellProps) {
  if (!open) return null;

  const card = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="contextual-refiner-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
        overflow: "auto",
        backgroundColor: "rgba(0,0,0,0.55)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        style={{
          ...card,
          width: "100%",
          maxWidth: 520,
          marginTop: 20,
          maxHeight: "min(90vh, 720px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2
            id="contextual-refiner-title"
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 600,
              color: text,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h2>
          {subtitle ? (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 13,
                color: mutedColor,
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </p>
          ) : null}
          <p
            style={{
              margin: subtitle ? "8px 0 0" : "8px 0 0",
              fontSize: 12,
              fontWeight: 600,
              color: text,
              padding: "8px 10px",
              borderRadius: 8,
              backgroundColor: bg,
              border: `1px solid ${borderSubtle}`,
            }}
          >
            {contextLabel}
          </p>
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            paddingRight: 2,
          }}
        >
          {children}
        </div>

        <footer
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            paddingTop: 8,
            borderTop: `1px solid ${borderSubtle}`,
          }}
        >
          {applyFootnote ? (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: mutedColor,
                lineHeight: 1.5,
              }}
            >
              {applyFootnote}
            </p>
          ) : null}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
          <button
            type="button"
            onClick={onDismiss}
            disabled={isApplying}
            style={{ ...btnGhost, fontSize: 13 }}
          >
            {dismissLabel}
          </button>
          {onApply ? (
            <button
              type="button"
              onClick={onApply}
              disabled={applyDisabled || isApplying}
              style={{ ...btn, fontSize: 13, opacity: applyDisabled ? 0.5 : 1 }}
            >
              {isApplying ? "Applying…" : applyLabel}
            </button>
          ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

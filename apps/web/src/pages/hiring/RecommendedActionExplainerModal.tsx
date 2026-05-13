import {
  border,
  btnGhost,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import type { RecommendedAction } from "./hiringRecommendedActions";

type Props = {
  open: boolean;
  action: RecommendedAction | null;
  onClose: () => void;
};

/** Lightweight explainer only — no tasks, no persistence. */
export function RecommendedActionExplainerModal({
  open,
  action,
  onClose,
}: Props) {
  if (!open || !action) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="rec-action-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 85,
        padding: 16,
      }}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "20px 22px",
          boxSizing: "border-box",
        }}
      >
        <h3
          id="rec-action-title"
          style={{
            margin: "0 0 10px",
            fontSize: 17,
            fontWeight: 600,
            color: text,
          }}
        >
          {action.label}
        </h3>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 14,
            color: text,
            lineHeight: 1.55,
          }}
        >
          {action.explanation}
        </p>
        {action.foundationNote ? (
          <p
            style={{
              margin: "0 0 14px",
              fontSize: 12,
              color: mutedColor,
              lineHeight: 1.5,
              fontStyle: "italic",
            }}
          >
            {action.foundationNote}
          </p>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

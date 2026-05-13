import { useCallback, useState } from "react";
import {
  border,
  btnGhost,
  btnPrimary,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import {
  REQUEST_REFEREES_GUIDANCE,
  REQUEST_REFEREES_SUGGESTED_MESSAGE,
  requestRefereesCopyAllText,
} from "./requestRefereesModalCopy";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function RequestRefereesModal({ open, onClose }: Props) {
  const [copyHint, setCopyHint] = useState<string | null>(null);

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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="rr-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 94,
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
          id="rr-title"
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Request referees
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
          Copy and send through your own email or messaging — nothing is sent from Capability Studio.
        </p>

        <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            style={btnPrimary}
            onClick={() => void copyText(requestRefereesCopyAllText(), "Copied all")}
          >
            Copy all
          </button>
          <button
            type="button"
            style={btnGhost}
            onClick={() => void copyText(REQUEST_REFEREES_SUGGESTED_MESSAGE, "Copied message")}
          >
            Copy message
          </button>
          {copyHint ? (
            <span style={{ fontSize: 12, color: mutedColor, alignSelf: "center" }}>
              {copyHint}
            </span>
          ) : null}
        </div>

        <section style={{ marginBottom: 18 }}>
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
            Guidance
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: text, lineHeight: 1.55 }}>
            {REQUEST_REFEREES_GUIDANCE}
          </p>
        </section>

        <section style={{ marginBottom: 18 }}>
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
            Suggested request message
          </p>
          <pre
            style={{
              margin: "8px 0 0",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: "rgba(15, 23, 42, 0.5)",
              fontSize: 13,
              color: text,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
            }}
          >
            {REQUEST_REFEREES_SUGGESTED_MESSAGE}
          </pre>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

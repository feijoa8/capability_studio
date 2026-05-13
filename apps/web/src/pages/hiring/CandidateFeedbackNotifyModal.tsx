import { useCallback, useMemo, useState } from "react";
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
  buildRejectionFeedbackBundle,
  rejectionFeedbackToPlainText,
  type RejectionFeedbackBundle,
} from "./candidateRejectionFeedback";

type Props = {
  open: boolean;
  onClose: () => void;
  applicationRow: HiringApplicationRow;
};

function BulletList({ items }: { items: string[] }) {
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
      {items.map((line, i) => (
        <li key={`${i}-${line.slice(0, 40)}`} style={{ marginBottom: 8 }}>
          {line}
        </li>
      ))}
    </ul>
  );
}

function MessageBlock({ body }: { body: string }) {
  return (
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
      {body}
    </pre>
  );
}

export function CandidateFeedbackNotifyModal({ open, onClose, applicationRow }: Props) {
  const bundle: RejectionFeedbackBundle = useMemo(
    () => buildRejectionFeedbackBundle(applicationRow),
    [applicationRow],
  );

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

  const copyAll = useCallback(async () => {
    await copyText(rejectionFeedbackToPlainText(bundle), "Copied all");
  }, [bundle, copyText]);

  const copyMessage = useCallback(async () => {
    await copyText(bundle.candidateMessage, "Copied message");
  }, [bundle.candidateMessage, copyText]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="cfn-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 93,
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
          id="cfn-title"
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Candidate feedback & notification
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
          Drafts only — copy into your own email or ATS. Nothing is sent from Capability Studio.
        </p>

        <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" style={btnPrimary} onClick={() => void copyAll()}>
            Copy all
          </button>
          <button type="button" style={btnGhost} onClick={() => void copyMessage()}>
            Copy message
          </button>
          {copyHint ? (
            <span style={{ fontSize: 12, color: mutedColor, alignSelf: "center" }}>
              {copyHint}
            </span>
          ) : null}
        </div>

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
              Strengths to acknowledge
            </p>
            <button
              type="button"
              style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
              onClick={() =>
                void copyText(bundle.strengthsToAcknowledge.join("\n"), "Copied section")
              }
            >
              Copy section
            </button>
          </div>
          <BulletList items={bundle.strengthsToAcknowledge} />
        </section>

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
              Development feedback
            </p>
            <button
              type="button"
              style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
              onClick={() =>
                void copyText(bundle.developmentFeedback.join("\n"), "Copied section")
              }
            >
              Copy section
            </button>
          </div>
          <BulletList items={bundle.developmentFeedback} />
        </section>

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
              Suggested candidate message
            </p>
            <button
              type="button"
              style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
              onClick={() => void copyMessage()}
            >
              Copy message
            </button>
          </div>
          <MessageBlock body={bundle.candidateMessage} />
        </section>

        <p
          style={{
            margin: "0 0 16px",
            fontSize: 11,
            color: mutedColor,
            lineHeight: 1.5,
            fontStyle: "italic",
          }}
        >
          Future enhancement: selected development feedback may be reusable as candidate capability
          insight.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

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
  REFERENCE_CHECK_INTRO,
  REFERENCE_CHECK_SECTIONS,
  referenceCheckGuideToPlainText,
  referenceCheckSectionPlainText,
  type ReferenceCheckSection,
} from "./referenceCheckGuideContent";

type Props = {
  open: boolean;
  onClose: () => void;
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

export function ReferenceCheckGuideModal({ open, onClose }: Props) {
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
    await copyText(referenceCheckGuideToPlainText(), "Copied all");
  }, [copyText]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="rcg-title"
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
          id="rcg-title"
          style={{
            margin: "0 0 6px",
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Reference check guide
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: text, lineHeight: 1.55 }}>
          {REFERENCE_CHECK_INTRO}
        </p>

        <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" style={btnPrimary} onClick={() => void copyAll()}>
            Copy all questions
          </button>
          {copyHint ? (
            <span style={{ fontSize: 12, color: mutedColor, alignSelf: "center" }}>
              {copyHint}
            </span>
          ) : null}
        </div>

        {REFERENCE_CHECK_SECTIONS.map((section: ReferenceCheckSection) => (
          <section key={section.id} style={{ marginBottom: 18 }}>
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
                {section.title}
              </p>
              <button
                type="button"
                style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                onClick={() =>
                  void copyText(
                    `${section.title}\n${referenceCheckSectionPlainText(section)}`,
                    "Copied section",
                  )
                }
              >
                Copy section
              </button>
            </div>
            <QuestionList items={section.questions} />
          </section>
        ))}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

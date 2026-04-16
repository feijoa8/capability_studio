import type { ReactNode } from "react";
import type { RefinementSuggestionPayload } from "./types";
import { bg, border, borderSubtle, mutedColor, text } from "../hubTheme";

type Props = {
  suggestion: RefinementSuggestionPayload | null;
  /** When no suggestion yet (e.g. API not wired). */
  placeholder?: ReactNode;
};

function TagBlock({ items }: { items: string[] }) {
  if (items.length === 0) {
    return (
      <p style={{ margin: "4px 0 0", fontSize: 12, color: mutedColor }}>—</p>
    );
  }
  return (
    <ul
      style={{
        margin: "6px 0 0",
        padding: "0 0 0 18px",
        fontSize: 13,
        color: text,
        lineHeight: 1.5,
      }}
    >
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/**
 * Read-only structured preview of refiner output; four categories stay separate.
 */
export function RefinementSuggestionPreview({
  suggestion,
  placeholder,
}: Props) {
  if (!suggestion) {
    return (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          backgroundColor: bg,
          border: `1px dashed ${borderSubtle}`,
          fontSize: 13,
          color: mutedColor,
          lineHeight: 1.55,
        }}
      >
        {placeholder ?? (
          <>
            No suggestions yet. When an AI backend is connected, proposed summary
            and tags will appear here for review—nothing applies until you
            confirm.
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {suggestion.rationale ? (
        <div>
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
            Rationale
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: text,
              lineHeight: 1.5,
            }}
          >
            {suggestion.rationale}
          </p>
        </div>
      ) : null}

      {suggestion.suggestedDescription ? (
        <div>
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
            Suggested summary
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: text,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {suggestion.suggestedDescription}
          </p>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr",
        }}
      >
        <div>
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
            Skills
          </p>
          <TagBlock items={suggestion.suggestedSkills} />
        </div>
        <div>
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
            Methods / practices
          </p>
          <TagBlock items={suggestion.suggestedMethods} />
        </div>
        <div>
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
            Tools / platforms
          </p>
          <TagBlock items={suggestion.suggestedTools} />
        </div>
        <div>
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
            Industry / domain
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: text }}>
            {suggestion.suggestedIndustry?.trim() || "—"}
          </p>
        </div>
      </div>

      {suggestion.followUpQuestions.length > 0 ? (
        <div>
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
            Follow-up questions
          </p>
          <ul
            style={{
              margin: "6px 0 0",
              padding: "0 0 0 18px",
              fontSize: 13,
              color: text,
              lineHeight: 1.5,
            }}
          >
            {suggestion.followUpQuestions.map((q) => (
              <li key={q.id}>
                {q.question}
                {q.optional ? (
                  <span style={{ color: mutedColor }}> (optional)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

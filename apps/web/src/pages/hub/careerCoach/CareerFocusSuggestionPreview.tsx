import type { ReactNode } from "react";
import { bg, borderSubtle, mutedColor, text } from "../hubTheme";
import type { CareerFocusSuggestionPayload } from "./types";

type Props = {
  suggestion: CareerFocusSuggestionPayload | null;
  placeholder?: ReactNode;
};

function SignalsRow(props: {
  label: string;
  items?: string[];
}) {
  const items = (props.items ?? []).map((x) => x.trim()).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <p style={{ margin: "8px 0 0", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
      <span style={{ color: mutedColor, fontWeight: 600 }}>{props.label}:</span>{" "}
      <span style={{ color: text }}>{items.slice(0, 8).join(", ")}</span>
      {items.length > 8 ? <span style={{ color: mutedColor }}> …</span> : null}
    </p>
  );
}

export function CareerFocusSuggestionPreview({ suggestion, placeholder }: Props) {
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
        {placeholder ?? <>No focus areas yet.</>}
      </div>
    );
  }

  const areas = suggestion.focus_areas ?? [];
  if (areas.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: mutedColor, lineHeight: 1.55 }}>
        No focus areas were suggested from the current evidence. Add more evidence
        (roles, projects, tags) or clarify your target roles and try again.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {areas.map((a, idx) => (
        <div
          key={`${a.title}-${idx}`}
          style={{
            padding: "12px 12px",
            borderRadius: 10,
            border: `1px solid ${borderSubtle}`,
            backgroundColor: bg,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: text }}>
              {a.title}
            </p>
            {typeof a.confidence === "number" ? (
              <span style={{ fontSize: 11, color: mutedColor }}>
                Confidence: {Math.round(a.confidence * 100)}%
              </span>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: text, lineHeight: 1.5 }}>
            {a.description}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: mutedColor, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600 }}>Why this matters:</span>{" "}
            {a.rationale}
          </p>
          <div>
            <SignalsRow label="Skills" items={a.related_signals?.skills} />
            <SignalsRow label="Methods" items={a.related_signals?.methods} />
            <SignalsRow label="Tools" items={a.related_signals?.tools} />
            <SignalsRow label="Industries" items={a.related_signals?.industries} />
          </div>
        </div>
      ))}

      {Array.isArray(suggestion.follow_ups) && suggestion.follow_ups.length > 0 ? (
        <div style={{ paddingTop: 2 }}>
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
            Follow-ups
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
            {suggestion.follow_ups.slice(0, 5).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}


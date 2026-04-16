import type { ReactNode } from "react";
import type { UserExperienceRow } from "../types";
import {
  accent,
  accentMuted,
  borderSubtle,
  brandLimeMuted,
  errorColor,
  mutedColor,
  text,
} from "../hubTheme";
import {
  compareIndustry,
  compareTagArrays,
  descriptionsEffectivelyEqual,
  type TagDelta,
} from "./refinementDelta";
import type { RefinementSuggestionPayload } from "./types";

type Props = {
  experience: UserExperienceRow;
  suggestion: RefinementSuggestionPayload | null;
  placeholder?: ReactNode;
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
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
      {children}
    </p>
  );
}

function DescriptionBlock({
  label,
  variant,
  body,
}: {
  label: string;
  variant: "current" | "suggested";
  body: string;
}) {
  const borderColor = variant === "current" ? borderSubtle : accent;
  const backgroundColor =
    variant === "current" ? "rgba(255,255,255,0.03)" : accentMuted;
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          color: mutedColor,
        }}
      >
        {label}
      </p>
      <div
        style={{
          marginTop: 6,
          padding: "10px 12px",
          borderRadius: 8,
          borderLeft: `3px solid ${borderColor}`,
          backgroundColor,
          fontSize: 13,
          color: text,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {body.length > 0 ? body : (
          <span style={{ color: mutedColor }}>—</span>
        )}
      </div>
    </div>
  );
}

function TagChipRow({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "add" | "remove" | "neutral";
  items: string[];
}) {
  if (items.length === 0) return null;
  const bg =
    tone === "add"
      ? brandLimeMuted
      : tone === "remove"
        ? "rgba(232, 120, 120, 0.12)"
        : "rgba(255,255,255,0.04)";
  const borderCol =
    tone === "add"
      ? "rgba(196, 245, 66, 0.35)"
      : tone === "remove"
        ? "rgba(232, 120, 120, 0.35)"
        : borderSubtle;
  const labelColor =
    tone === "add"
      ? "#d4f090"
      : tone === "remove"
        ? errorColor
        : mutedColor;

  return (
    <div style={{ marginTop: 8 }}>
      <p
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          color: labelColor,
        }}
      >
        {label}
      </p>
      <ul
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          margin: "6px 0 0",
          padding: 0,
          listStyle: "none",
        }}
      >
        {items.map((t) => (
          <li
            key={`${label}-${t}`}
            style={{
              margin: 0,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 12,
              color: text,
              backgroundColor: bg,
              border: `1px solid ${borderCol}`,
              lineHeight: 1.35,
            }}
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TagCategoryDelta({
  title,
  delta,
  emptyCopy,
}: {
  title: string;
  delta: TagDelta;
  emptyCopy: string;
}) {
  const nAdd = delta.added.length;
  const nRem = delta.removed.length;
  const nUnch = delta.unchanged.length;
  const anyTags = nAdd + nRem + nUnch > 0;

  if (!anyTags) {
    return (
      <div>
        <SectionTitle>{title}</SectionTitle>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
          {emptyCopy}
        </p>
      </div>
    );
  }

  if (nAdd === 0 && nRem === 0) {
    return (
      <div>
        <SectionTitle>{title}</SectionTitle>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
          No change{nUnch > 0 ? ` (${nUnch} unchanged)` : ""}.
        </p>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <TagChipRow label="Added" tone="add" items={delta.added} />
      <TagChipRow label="Removed" tone="remove" items={delta.removed} />
      {nUnch > 0 ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: mutedColor }}>
          Unchanged: {nUnch} tag{nUnch === 1 ? "" : "s"} (stays on the form after
          apply).
        </p>
      ) : null}
    </div>
  );
}

/**
 * Read-only delta view: current role vs AI suggestion (review before apply-to-form).
 */
export function RefinementDeltaPreview({
  experience,
  suggestion,
  placeholder,
}: Props) {
  if (!suggestion) {
    return (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          backgroundColor: "rgba(255,255,255,0.02)",
          border: `1px dashed ${borderSubtle}`,
          fontSize: 13,
          color: mutedColor,
          lineHeight: 1.55,
        }}
      >
        {placeholder ?? (
          <>
            No suggestions yet. When the refiner returns data, you will see what
            would change before applying to the edit form.
          </>
        )}
      </div>
    );
  }

  const currentDesc = experience.description ?? "";
  const suggestedDesc = suggestion.suggestedDescription ?? "";
  const descEqual = descriptionsEffectivelyEqual(currentDesc, suggestedDesc);
  const hasDescText = currentDesc.trim().length > 0 || suggestedDesc.trim().length > 0;

  const skillsDelta = compareTagArrays(experience.skills, suggestion.suggestedSkills);
  const methodsDelta = compareTagArrays(
    experience.methods,
    suggestion.suggestedMethods,
  );
  const toolsDelta = compareTagArrays(experience.tools, suggestion.suggestedTools);
  const industryDelta = compareIndustry(
    experience.industry,
    suggestion.suggestedIndustry,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <SectionTitle>Summary improvement</SectionTitle>
        {suggestion.rationale ? (
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
        ) : null}
        <p
          style={{
            margin: suggestion.rationale ? "10px 0 0" : "6px 0 0",
            fontSize: 11,
            fontWeight: 600,
            color: mutedColor,
          }}
        >
          Description
        </p>
        {!hasDescText ? (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
            No summary text on this role or in the suggestion.
          </p>
        ) : descEqual ? (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
            No change to the description.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
            <DescriptionBlock
              label="Current"
              variant="current"
              body={currentDesc.trim()}
            />
            <DescriptionBlock
              label="Suggested"
              variant="suggested"
              body={suggestedDesc.trim()}
            />
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          paddingTop: 4,
          borderTop: `1px solid ${borderSubtle}`,
        }}
      >
        <SectionTitle>Tag changes</SectionTitle>
        <TagCategoryDelta
          title="Skills"
          delta={skillsDelta}
          emptyCopy="No skills on this role or in the suggestion."
        />
        <TagCategoryDelta
          title="Methods / practices"
          delta={methodsDelta}
          emptyCopy="No methods on this role or in the suggestion."
        />
        <TagCategoryDelta
          title="Tools / platforms"
          delta={toolsDelta}
          emptyCopy="No tools on this role or in the suggestion."
        />
        <div>
          <SectionTitle>Industry / domain</SectionTitle>
          {!industryDelta.currentDisplay && !industryDelta.suggestedDisplay ? (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
              No industry set on this role or in the suggestion.
            </p>
          ) : industryDelta.isEqual ? (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
              No change to industry.
            </p>
          ) : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <DescriptionBlock
                label="Current industry"
                variant="current"
                body={industryDelta.currentDisplay}
              />
              <DescriptionBlock
                label="Suggested industry"
                variant="suggested"
                body={industryDelta.suggestedDisplay}
              />
            </div>
          )}
        </div>
      </div>

      {suggestion.followUpQuestions.length > 0 ? (
        <div
          style={{
            paddingTop: 4,
            borderTop: `1px solid ${borderSubtle}`,
          }}
        >
          <SectionTitle>Follow-up questions</SectionTitle>
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

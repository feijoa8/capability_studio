import type { DevelopmentGoalNoteRow, DevelopmentGoalRow } from "./types";
import {
  competencyNameFromGoal,
  formatDevelopmentGoalNoteTimestamp,
} from "./developmentGoalUtils";
import { accent, bg, border, btn, btnGhost, mutedColor, text } from "./hubTheme";

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  color: text,
  backgroundColor: bg,
  border: `1px solid ${border}`,
  borderRadius: 8,
  boxSizing: "border-box" as const,
} as const;

const labelStyle = {
  display: "grid" as const,
  gap: 6,
  fontSize: 13,
  color: mutedColor,
};

export type DevelopmentGoalInlineDetailProps = {
  goal: DevelopmentGoalRow;
  /** Dashboard: full header row with title + Details/Hide. Compact: summary line + View goal/Hide. */
  variant: "dashboard" | "compact";
  expanded: boolean;
  onToggleExpand: () => void;
  progressDraft: number;
  onProgressDraftChange: (v: number) => void;
  goalNoteDraft: string;
  onGoalNoteDraftChange: (v: string) => void;
  notes: DevelopmentGoalNoteRow[];
  onSaveProgress: () => void;
  onMarkComplete: () => void;
  actionLoading: boolean;
};

/**
 * Inline development goal detail: summary, progress bar, and expandable actions
 * (mirrors My Dashboard goal cards).
 */
export function DevelopmentGoalInlineDetail({
  goal: g,
  variant,
  expanded,
  onToggleExpand,
  progressDraft,
  onProgressDraftChange,
  goalNoteDraft,
  onGoalNoteDraftChange,
  notes,
  onSaveProgress,
  onMarkComplete,
  actionLoading,
}: DevelopmentGoalInlineDetailProps) {
  const prog = progressDraft;
  const barPct = expanded ? prog : g.progress;

  return (
    <>
      {variant === "dashboard" ? (
        <button
          type="button"
          onClick={onToggleExpand}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 15,
                color: text,
              }}
            >
              {g.title}
            </div>
            <div
              style={{
                fontSize: 12,
                color: mutedColor,
                marginTop: 4,
                textTransform: "capitalize",
              }}
            >
              {g.status.replace("_", " ")} · {g.progress}%
            </div>
          </div>
          <span style={{ fontSize: 12, color: mutedColor }}>
            {expanded ? "Hide" : "Details"}
          </span>
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 12, color: mutedColor }}>
            Goal:{" "}
            <span style={{ color: text }}>
              {g.status.replace("_", " ")} · {g.progress}%
            </span>
          </span>
          <button
            type="button"
            onClick={onToggleExpand}
            style={{
              ...btn,
              fontSize: 12,
              padding: "6px 12px",
            }}
          >
            {expanded ? "Hide" : "View goal"}
          </button>
        </div>
      )}

      <div
        style={{
          marginTop: 10,
          height: 6,
          borderRadius: 4,
          backgroundColor: bg,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${barPct}%`,
            backgroundColor: accent,
            borderRadius: 4,
            transition: "width 0.2s ease",
          }}
        />
      </div>

      {expanded ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: `1px solid ${border}`,
            display: "grid",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: mutedColor }}>
              {variant === "compact" ? "Goal" : "Competency"}
            </div>
            <div style={{ fontSize: 14, color: text, fontWeight: 600 }}>
              {variant === "compact" ? g.title : competencyNameFromGoal(g)}
            </div>
          </div>
          {variant === "dashboard" ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                fontSize: 13,
                color: mutedColor,
              }}
            >
              <span>
                Current:{" "}
                <span style={{ color: text }}>{g.current_level}</span>
              </span>
              <span>
                Target:{" "}
                <span style={{ color: text }}>{g.target_level}</span>
              </span>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                fontSize: 13,
                color: mutedColor,
              }}
            >
              <span>
                Status:{" "}
                <span style={{ color: text, textTransform: "capitalize" }}>
                  {g.status.replace("_", " ")}
                </span>
              </span>
              <span>
                Current:{" "}
                <span style={{ color: text }}>{g.current_level}</span>
              </span>
              <span>
                Target:{" "}
                <span style={{ color: text }}>{g.target_level}</span>
              </span>
            </div>
          )}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: mutedColor,
                marginBottom: 8,
              }}
            >
              Suggested actions
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                color: text,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {(g.suggested_actions ?? []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <label style={labelStyle}>
            Progress ({prog}%)
            <input
              type="range"
              min={0}
              max={100}
              value={prog}
              onChange={(e) => {
                onProgressDraftChange(Number(e.target.value));
              }}
              disabled={actionLoading}
              style={{ width: "100%" }}
            />
          </label>
          <label style={labelStyle}>
            <span style={{ fontSize: 12 }}>Reflection</span>
            <textarea
              value={goalNoteDraft}
              onChange={(e) => onGoalNoteDraftChange(e.target.value)}
              placeholder="What did you do or learn?"
              rows={3}
              disabled={actionLoading}
              style={{
                ...inputStyle,
                resize: "vertical" as const,
                fontFamily: "inherit",
                lineHeight: 1.45,
              }}
            />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              disabled={actionLoading}
              onClick={onSaveProgress}
              style={{ ...btn, fontSize: 13 }}
            >
              {goalNoteDraft.trim() ? "Save update" : "Save progress"}
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={onMarkComplete}
              style={{ ...btn, fontSize: 13 }}
            >
              Mark complete
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={onToggleExpand}
              style={{ ...btnGhost, fontSize: 13 }}
            >
              Collapse
            </button>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: mutedColor,
                marginBottom: 8,
              }}
            >
              Progress notes
            </div>
            {notes.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: mutedColor,
                }}
              >
                No notes yet. Add a reflection when you save.
              </p>
            ) : (
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {notes.map((n) => (
                  <li
                    key={n.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      backgroundColor: bg,
                      border: `1px solid ${border}`,
                      fontSize: 13,
                      lineHeight: 1.45,
                      color: text,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: mutedColor,
                        marginBottom: 6,
                      }}
                    >
                      {formatDevelopmentGoalNoteTimestamp(n.created_at)}
                      {n.progress_snapshot != null ? (
                        <span>
                          {" "}
                          · {n.progress_snapshot}% progress
                        </span>
                      ) : null}
                    </div>
                    {n.note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

export { normalizeDevelopmentGoal } from "./developmentGoalUtils";

import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { bg, border, mutedColor, text } from "./hubTheme";
import { dedupeSkillsNormalized, normalizeSkillLabel } from "./skillNormalization";

export type SkillTagInputProps = {
  id?: string;
  label: ReactNode;
  skills: string[];
  onSkillsChange: (skills: string[]) => void;
  /** Prior skills from saved experience + project rows (normalized, deduped). */
  suggestionPool: string[];
  placeholder?: string;
};

const MAX_SUGGESTIONS = 20;

export function SkillTagInput({
  id,
  label,
  skills,
  onSkillsChange,
  suggestionPool,
  placeholder = "Type a skill and press Enter",
}: SkillTagInputProps) {
  const [inputValue, setInputValue] = useState("");

  const selectedLower = useMemo(
    () => new Set(skills.map((s) => s.toLowerCase())),
    [skills]
  );

  const filteredSuggestions = useMemo(() => {
    const pool = suggestionPool.filter((s) => !selectedLower.has(s.toLowerCase()));
    const q = inputValue.trim().toLowerCase();
    if (!q) return pool.slice(0, MAX_SUGGESTIONS);
    return pool
      .filter((s) => s.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestionPool, inputValue, selectedLower]);

  const commitInput = useCallback(() => {
    const n = normalizeSkillLabel(inputValue);
    setInputValue("");
    if (!n) return;
    if (skills.some((s) => s.toLowerCase() === n.toLowerCase())) return;
    onSkillsChange(dedupeSkillsNormalized([...skills, n]));
  }, [inputValue, skills, onSkillsChange]);

  const addFromSuggestion = useCallback(
    (suggestion: string) => {
      const n = normalizeSkillLabel(suggestion);
      if (!n) return;
      if (skills.some((x) => x.toLowerCase() === n.toLowerCase())) return;
      onSkillsChange(dedupeSkillsNormalized([...skills, n]));
      setInputValue("");
    },
    [skills, onSkillsChange]
  );

  const removeAt = useCallback(
    (index: number) => {
      onSkillsChange(skills.filter((_, i) => i !== index));
    },
    [skills, onSkillsChange]
  );

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInput();
      return;
    }
    if (e.key === "," || e.key === ";") {
      e.preventDefault();
      commitInput();
    }
    if (e.key === "Backspace" && !inputValue && skills.length > 0) {
      removeAt(skills.length - 1);
    }
  }

  const badgeStyle = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: 4,
    fontSize: 11,
    padding: "4px 6px 4px 8px",
    borderRadius: 6,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    color: text,
  };

  const inputStyle = {
    flex: "1 1 120px",
    minWidth: 120,
    padding: "6px 8px",
    fontSize: 14,
    color: text,
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
  } as const;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 13, color: mutedColor }}>{label}</span>
      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            minHeight: 42,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${border}`,
            backgroundColor: bg,
            boxSizing: "border-box" as const,
          }}
        >
          {skills.map((s, i) => (
            <span key={`${s}-${i}`} style={badgeStyle}>
              <span>{s}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${s}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  padding: 0,
                  margin: 0,
                  border: "none",
                  borderRadius: 4,
                  background: "transparent",
                  color: mutedColor,
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            id={id}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (inputValue.trim()) commitInput();
            }}
            placeholder={skills.length === 0 ? placeholder : ""}
            autoComplete="off"
            style={inputStyle}
          />
        </div>
        {filteredSuggestions.length > 0 && inputValue.trim() ? (
          <ul
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "100%",
              margin: "4px 0 0",
              padding: 4,
              listStyle: "none",
              maxHeight: 200,
              overflowY: "auto",
              borderRadius: 8,
              border: `1px solid ${border}`,
              backgroundColor: bg,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              zIndex: 10,
            }}
          >
            {filteredSuggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addFromSuggestion(s)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    fontSize: 13,
                    color: text,
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

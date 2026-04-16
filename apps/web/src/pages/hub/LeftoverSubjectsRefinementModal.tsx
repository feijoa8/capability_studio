import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  analyzeLeftoverSubjects,
  type LeftoverSubjectSuggestion,
} from "../../lib/leftoverSubjectRefinement";
import type {
  CapabilityAreaRow,
  CompetencySubjectRow,
  OrganisationProfileRow,
} from "./types";
import { isAssignableLifecycleStatus } from "./competencyLifecycle";
import {
  isProtectedGovernance,
  parseTaxonomyGovernanceStatus,
} from "./taxonomyGovernance";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  btnPrimary,
  errorColor,
  mutedColor,
  surface,
  text,
} from "./hubTheme";

function normKey(name: string): string {
  return name.trim().toLowerCase();
}

function findAreaIdByName(
  areas: CapabilityAreaRow[],
  name: string
): string | null {
  const k = normKey(name);
  const a = areas.find((x) => normKey(x.name) === k);
  return a?.id ?? null;
}

export type LeftoverSubjectsRefinementModalProps = {
  open: boolean;
  onClose: () => void;
  activeOrgId: string;
  subjects: CompetencySubjectRow[];
  capabilityAreas: CapabilityAreaRow[];
  companyProfile: OrganisationProfileRow | null;
  onApplied: () => void | Promise<void>;
};

type Step = "setup" | "review";

type DecisionValue =
  | "accept"
  | `existing:${string}`
  | "unassigned"
  | "later";

export function LeftoverSubjectsRefinementModal({
  open,
  onClose,
  activeOrgId,
  subjects,
  capabilityAreas,
  companyProfile,
  onApplied,
}: LeftoverSubjectsRefinementModalProps) {
  const [step, setStep] = useState<Step>("setup");
  const [onlyDraft, setOnlyDraft] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<LeftoverSubjectSuggestion[]>(
    []
  );
  const [decisions, setDecisions] = useState<Record<string, DecisionValue>>({});
  const [applyLoading, setApplyLoading] = useState(false);

  const leftoverSubjects = useMemo(() => {
    return subjects.filter((s) => {
      if (!isAssignableLifecycleStatus(s.status)) return false;
      if (s.capability_area_id) return false;
      const g = parseTaxonomyGovernanceStatus(s.governance_status);
      if (isProtectedGovernance(g)) return false;
      if (onlyDraft && g !== "draft") return false;
      return true;
    });
  }, [subjects, onlyDraft]);

  const suggestionBySubjectId = useMemo(() => {
    const m = new Map<string, LeftoverSubjectSuggestion>();
    for (const x of suggestions) m.set(x.subject_id, x);
    return m;
  }, [suggestions]);

  const pendingApplyCount = useMemo(() => {
    let n = 0;
    for (const s of leftoverSubjects) {
      const d = decisions[s.id] ?? "later";
      if (d === "later" || d === "unassigned") continue;
      if (d === "accept") {
        const sug = suggestionBySubjectId.get(s.id);
        if (!sug) continue;
        const id = findAreaIdByName(
          capabilityAreas,
          sug.suggested_capability_area_name
        );
        if (id) n++;
        continue;
      }
      if (d.startsWith("existing:")) {
        const id = d.slice("existing:".length);
        if (id) n++;
      }
    }
    return n;
  }, [
    leftoverSubjects,
    decisions,
    suggestionBySubjectId,
    capabilityAreas,
  ]);

  function resetModal() {
    setStep("setup");
    setOnlyDraft(true);
    setAnalysisLoading(false);
    setAnalysisError(null);
    setSuggestions([]);
    setDecisions({});
    setApplyLoading(false);
  }

  function handleClose() {
    resetModal();
    onClose();
  }

  async function runAnalysis() {
    setAnalysisError(null);
    if (leftoverSubjects.length === 0) {
      setAnalysisError("No matching leftover subjects with current filters.");
      return;
    }
    setAnalysisLoading(true);
    try {
      const payload = leftoverSubjects.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        description: s.description?.trim() ? s.description : null,
        governance_status: parseTaxonomyGovernanceStatus(s.governance_status),
      }));
      const result = await analyzeLeftoverSubjects({
        companyProfile,
        capabilityAreas: capabilityAreas.map((a) => ({
          id: a.id,
          name: a.name.trim(),
          description: a.description?.trim() ? a.description : null,
          governance_status: a.governance_status ?? "draft",
        })),
        subjects: payload,
      });
      setSuggestions(result.suggestions);
      const next: Record<string, DecisionValue> = {};
      for (const s of leftoverSubjects) {
        const sug = result.suggestions.find((x) => x.subject_id === s.id);
        const match = sug
          ? findAreaIdByName(capabilityAreas, sug.suggested_capability_area_name)
          : null;
        next[s.id] = match ? "accept" : "unassigned";
      }
      setDecisions(next);
      setStep("review");
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  function setDecision(subjectId: string, value: DecisionValue) {
    setDecisions((prev) => ({ ...prev, [subjectId]: value }));
  }

  async function applyChanges() {
    const confirmed = window.confirm(
      `Apply ${pendingApplyCount} capability area assignment(s)? Subjects are not merged or deleted.`
    );
    if (!confirmed) return;

    setApplyLoading(true);
    try {
      for (const s of leftoverSubjects) {
        const d = decisions[s.id] ?? "later";
        if (d === "later" || d === "unassigned") continue;

        let nextId: string | null = null;
        if (d === "accept") {
          const sug = suggestionBySubjectId.get(s.id);
          if (!sug) continue;
          const id = findAreaIdByName(
            capabilityAreas,
            sug.suggested_capability_area_name
          );
          if (!id) {
            alert(
              `No capability area named "${sug.suggested_capability_area_name}" — update "${s.name.trim()}" manually.`
            );
            continue;
          }
          nextId = id;
        } else if (d.startsWith("existing:")) {
          nextId = d.slice("existing:".length) || null;
        }

        if (nextId === (s.capability_area_id ?? null)) continue;

        const { error: uErr } = await supabase
          .from("competency_subjects")
          .update({ capability_area_id: nextId })
          .eq("id", s.id)
          .eq("organisation_id", activeOrgId);
        if (uErr) throw uErr;
      }

      await onApplied();
      handleClose();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setApplyLoading(false);
    }
  }

  if (!open) return null;

  const sortedLeftovers = [...leftoverSubjects].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="leftover-refine-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 93,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
        overflow: "auto",
        backgroundColor: "rgba(0,0,0,0.65)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !analysisLoading && !applyLoading) {
          handleClose();
        }
      }}
    >
      <div
        style={{
          width: "min(920px, 100%)",
          maxHeight: "min(92vh, 900px)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 10,
          padding: "18px 20px",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="leftover-refine-title"
          style={{
            margin: "0 0 8px",
            fontSize: 18,
            fontWeight: 700,
            color: text,
          }}
        >
          Refine leftovers
        </h2>
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 13,
            color: mutedColor,
            lineHeight: 1.45,
          }}
        >
          Targeted alignment for subjects with no capability area. Nothing is
          saved until you confirm. Does not change governance status or merge
          subjects.
        </p>

        {step === "setup" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                color: text,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={onlyDraft}
                onChange={(e) => setOnlyDraft(e.target.checked)}
                disabled={analysisLoading}
              />
              Only include <strong>draft</strong> subjects (recommended)
            </label>
            <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
              Leftover subjects matching filters:{" "}
              <strong style={{ color: text }}>{leftoverSubjects.length}</strong>{" "}
              (unassigned capability area; excludes protected).
            </p>
            {analysisError ? (
              <p style={{ margin: 0, fontSize: 13, color: errorColor }}>
                {analysisError}
              </p>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                disabled={analysisLoading || leftoverSubjects.length === 0}
                onClick={() => void runAnalysis()}
                style={btnPrimary}
              >
                {analysisLoading ? "Analysing…" : "Run AI analysis"}
              </button>
              <button
                type="button"
                disabled={analysisLoading}
                onClick={handleClose}
                style={btn}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {step === "review" && suggestions.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              flex: 1,
              minHeight: 0,
            }}
          >
            <div
              style={{
                overflow: "auto",
                flex: 1,
                border: `1px solid ${borderSubtle}`,
                borderRadius: 8,
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: surface, textAlign: "left" }}>
                    <th style={{ padding: "8px 10px", color: mutedColor }}>
                      Subject
                    </th>
                    <th style={{ padding: "8px 10px", color: mutedColor }}>
                      Suggestion
                    </th>
                    <th style={{ padding: "8px 10px", color: mutedColor }}>
                      Confidence
                    </th>
                    <th style={{ padding: "8px 10px", color: mutedColor }}>
                      Notes
                    </th>
                    <th style={{ padding: "8px 10px", color: mutedColor }}>
                      Decision
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeftovers.map((s) => {
                    const sug = suggestionBySubjectId.get(s.id);
                    const d = decisions[s.id] ?? "later";
                    const match = sug
                      ? findAreaIdByName(
                          capabilityAreas,
                          sug.suggested_capability_area_name
                        )
                      : null;
                    const conf = sug?.confidence ?? "medium";
                    const confColor =
                      conf === "high"
                        ? "#6bca7a"
                        : conf === "low"
                          ? "#c9a227"
                          : mutedColor;
                    return (
                      <tr
                        key={s.id}
                        style={{
                          borderTop: `1px solid ${borderSubtle}`,
                          backgroundColor: sug?.may_be_competency_instead
                            ? "rgba(212, 168, 75, 0.07)"
                            : undefined,
                        }}
                      >
                        <td style={{ padding: "8px 10px", color: text }}>
                          {s.name.trim()}
                          {sug?.may_be_competency_instead ? (
                            <span
                              style={{
                                display: "block",
                                marginTop: 4,
                                fontSize: 11,
                                color: "#d4a84b",
                              }}
                            >
                              May fit better as a competency under a subject
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: "8px 10px", color: mutedColor }}>
                          {sug ? (
                            <>
                              {sug.suggested_capability_area_name}
                              {match ? (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontSize: 11,
                                    color: "#6bca7a",
                                  }}
                                >
                                  (matches existing)
                                </span>
                              ) : (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontSize: 11,
                                    color: errorColor,
                                  }}
                                >
                                  (no exact name match)
                                </span>
                              )}
                              <div
                                style={{
                                  marginTop: 4,
                                  fontSize: 12,
                                  lineHeight: 1.4,
                                }}
                              >
                                {sug.reason}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ padding: "8px 10px", color: confColor }}>
                          {conf}
                        </td>
                        <td style={{ padding: "8px 10px", color: mutedColor }}>
                          {sug?.close_variant_or_merge_note ? (
                            <span style={{ fontSize: 12 }}>
                              {sug.close_variant_or_merge_note}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <select
                            value={d}
                            onChange={(e) =>
                              setDecision(s.id, e.target.value as DecisionValue)
                            }
                            disabled={applyLoading}
                            style={{
                              maxWidth: 240,
                              padding: "6px 8px",
                              fontSize: 13,
                              borderRadius: 6,
                              border: `1px solid ${border}`,
                              backgroundColor: bg,
                              color: text,
                            }}
                          >
                            {sug && match ? (
                              <option value="accept">Accept suggestion</option>
                            ) : null}
                            <optgroup label="Existing areas">
                              {capabilityAreas.map((a) => (
                                <option
                                  key={a.id}
                                  value={`existing:${a.id}` as DecisionValue}
                                >
                                  {a.name.trim()}
                                </option>
                              ))}
                            </optgroup>
                            <option value="unassigned">Leave unassigned</option>
                            <option value="later">Review later (no change)</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "flex-end",
                paddingTop: 8,
              }}
            >
              <button
                type="button"
                disabled={applyLoading}
                onClick={() => {
                  setStep("setup");
                  setSuggestions([]);
                }}
                style={btnGhost}
              >
                Back
              </button>
              <button
                type="button"
                disabled={applyLoading || pendingApplyCount === 0}
                onClick={() => void applyChanges()}
                style={btnPrimary}
              >
                {applyLoading
                  ? "Applying…"
                  : `Apply assignments (${pendingApplyCount})`}
              </button>
              <button
                type="button"
                disabled={applyLoading}
                onClick={handleClose}
                style={btn}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

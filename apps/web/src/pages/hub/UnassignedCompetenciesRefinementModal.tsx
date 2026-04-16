import { useMemo, useState } from "react";
import {
  analyzeUnassignedCompetencies,
  type UnassignedCompetencySuggestion,
} from "../../lib/unassignedCompetencyRefinement";
import type {
  CapabilityAreaRow,
  CompetencyRow,
  CompetencySubjectRow,
  OrganisationProfileRow,
} from "./types";
import { isAssignableLifecycleStatus } from "./competencyLifecycle";
import {
  parseTaxonomyGovernanceStatus,
} from "./taxonomyGovernance";
import { getCompetenciesInUnassignedSubjectBucket } from "./unassignedCompetencyBucket";
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

function findSubjectIdByName(
  subjects: CompetencySubjectRow[],
  name: string
): string | null {
  const k = normKey(name);
  const s = subjects.find((x) => normKey(x.name) === k);
  return s?.id ?? null;
}

export type UnassignedCompetenciesRefinementModalProps = {
  open: boolean;
  onClose: () => void;
  /** Same lifecycle/archived filtering as the capability catalogue tree. */
  competencies: CompetencyRow[];
  /** Subjects shown in the tree; used with competencies to match the unassigned bucket (including orphan links). */
  subjectsForCapabilityTree: CompetencySubjectRow[];
  subjects: CompetencySubjectRow[];
  capabilityAreas: CapabilityAreaRow[];
  companyProfile: OrganisationProfileRow | null;
  /** Return false to stop the batch (e.g. RLS error). */
  onApplyAssignment: (
    competencyId: string,
    subjectId: string | null
  ) => Promise<boolean>;
};

type Step = "setup" | "review";

type DecisionValue =
  | "accept"
  | `existing:${string}`
  | "unassigned"
  | "later";

export function UnassignedCompetenciesRefinementModal({
  open,
  onClose,
  competencies,
  subjectsForCapabilityTree,
  subjects,
  capabilityAreas,
  companyProfile,
  onApplyAssignment,
}: UnassignedCompetenciesRefinementModalProps) {
  const [step, setStep] = useState<Step>("setup");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<UnassignedCompetencySuggestion[]>(
    []
  );
  const [decisions, setDecisions] = useState<Record<string, DecisionValue>>({});
  const [applyLoading, setApplyLoading] = useState(false);

  const subjectIdsInCapabilityTree = useMemo(
    () => new Set(subjectsForCapabilityTree.map((s) => s.id)),
    [subjectsForCapabilityTree]
  );

  const unassignedCompetencies = useMemo(() => {
    return getCompetenciesInUnassignedSubjectBucket(
      competencies,
      subjectIdsInCapabilityTree
    );
  }, [competencies, subjectIdsInCapabilityTree]);

  const unassignedBucketBreakdown = useMemo(() => {
    let noSubjectId = 0;
    let orphanSubjectLink = 0;
    for (const c of unassignedCompetencies) {
      const sid = c.subject_id ?? null;
      if (!sid) noSubjectId++;
      else orphanSubjectLink++;
    }
    return { noSubjectId, orphanSubjectLink };
  }, [unassignedCompetencies]);

  const linkedInCatalogueViewCount = useMemo(() => {
    let n = 0;
    for (const c of competencies) {
      const sid = c.subject_id ?? null;
      if (sid && subjectIdsInCapabilityTree.has(sid)) n++;
    }
    return n;
  }, [competencies, subjectIdsInCapabilityTree]);

  const subjectAnchors = useMemo(() => {
    return subjects
      .filter((s) => isAssignableLifecycleStatus(s.status))
      .map((s) => {
        const area = s.capability_area_id
          ? capabilityAreas.find((a) => a.id === s.capability_area_id)
          : null;
        return {
          id: s.id,
          name: s.name.trim(),
          description: s.description?.trim() ? s.description : null,
          governance_status: parseTaxonomyGovernanceStatus(s.governance_status),
          capability_area_name: area?.name?.trim() ?? null,
          capability_area_governance: area
            ? parseTaxonomyGovernanceStatus(area.governance_status)
            : null,
        };
      });
  }, [subjects, capabilityAreas]);

  const suggestionByCompetencyId = useMemo(() => {
    const m = new Map<string, UnassignedCompetencySuggestion>();
    for (const x of suggestions) m.set(x.competency_id, x);
    return m;
  }, [suggestions]);

  const pendingApplyCount = useMemo(() => {
    let n = 0;
    for (const c of unassignedCompetencies) {
      const d = decisions[c.id] ?? "later";
      if (d === "later" || d === "unassigned") continue;
      if (d === "accept") {
        const sug = suggestionByCompetencyId.get(c.id);
        if (!sug) continue;
        const id = findSubjectIdByName(subjects, sug.suggested_subject_name);
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
    unassignedCompetencies,
    decisions,
    suggestionByCompetencyId,
    subjects,
  ]);

  function resetModal() {
    setStep("setup");
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
    if (unassignedCompetencies.length === 0) {
      setAnalysisError(
        "No competencies in scope — none match “Competencies not linked to a subject” for the current catalogue filters."
      );
      return;
    }
    if (subjectAnchors.length === 0) {
      setAnalysisError("Create at least one active subject before assigning competencies.");
      return;
    }
    setAnalysisLoading(true);
    try {
      const payload = unassignedCompetencies.map((c) => ({
        id: c.id,
        name: c.name.trim(),
        description: c.description?.trim() ? c.description : null,
        competency_type: c.competency_type ?? null,
      }));
      const result = await analyzeUnassignedCompetencies({
        companyProfile,
        subjectAnchors: subjectAnchors.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          governance_status: s.governance_status,
          capability_area_name: s.capability_area_name,
          capability_area_governance: s.capability_area_governance,
        })),
        competencies: payload,
      });
      setSuggestions(result.suggestions);
      const next: Record<string, DecisionValue> = {};
      for (const c of unassignedCompetencies) {
        const sug = result.suggestions.find((x) => x.competency_id === c.id);
        const match = sug
          ? findSubjectIdByName(subjects, sug.suggested_subject_name)
          : null;
        next[c.id] = match ? "accept" : "unassigned";
      }
      setDecisions(next);
      setStep("review");
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  function setDecision(competencyId: string, value: DecisionValue) {
    setDecisions((prev) => ({ ...prev, [competencyId]: value }));
  }

  async function applyChanges() {
    const confirmed = window.confirm(
      `Apply ${pendingApplyCount} subject assignment(s) to competencies? Subjects are not created or merged.`
    );
    if (!confirmed) return;

    setApplyLoading(true);
    try {
      for (const c of unassignedCompetencies) {
        const d = decisions[c.id] ?? "later";
        if (d === "later" || d === "unassigned") continue;

        let nextSubjectId: string | null = null;
        if (d === "accept") {
          const sug = suggestionByCompetencyId.get(c.id);
          if (!sug) continue;
          const id = findSubjectIdByName(subjects, sug.suggested_subject_name);
          if (!id) {
            alert(
              `No subject named "${sug.suggested_subject_name}" — fix "${c.name.trim()}" manually.`
            );
            continue;
          }
          nextSubjectId = id;
        } else if (d.startsWith("existing:")) {
          nextSubjectId = d.slice("existing:".length) || null;
        }

        if (nextSubjectId === (c.subject_id ?? null)) continue;

        const ok = await onApplyAssignment(c.id, nextSubjectId);
        if (!ok) break;
      }
      handleClose();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setApplyLoading(false);
    }
  }

  if (!open) return null;

  const sorted = unassignedCompetencies;

  const assignableSubjects = [...subjects]
    .filter((s) => isAssignableLifecycleStatus(s.status))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="unassigned-comp-refine-title"
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
          width: "min(960px, 100%)",
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
          id="unassigned-comp-refine-title"
          style={{
            margin: "0 0 8px",
            fontSize: 18,
            fontWeight: 700,
            color: text,
          }}
        >
          Refine competencies
        </h2>
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 13,
            color: mutedColor,
            lineHeight: 1.45,
          }}
        >
          Targeted AI alignment for competencies not linked to a subject. Nothing
          is saved until you confirm. Does not create subjects or merge
          competencies.
        </p>

        {step === "setup" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
              Scope matches the catalogue bucket{" "}
              <strong style={{ color: text }}>
                Competencies not linked to a subject
              </strong>{" "}
              for the same filters (lifecycle, archived, practice context, governance,
              etc.):{" "}
              <strong style={{ color: text }}>
                {unassignedCompetencies.length}
              </strong>{" "}
              eligible —{" "}
              <strong style={{ color: text }}>
                {unassignedBucketBreakdown.noSubjectId}
              </strong>{" "}
              with no subject,{" "}
              <strong style={{ color: text }}>
                {unassignedBucketBreakdown.orphanSubjectLink}
              </strong>{" "}
              with a subject link that is not in this view (orphan / filtered-out
              subject). Competencies already linked to a subject in this view are
              excluded (
              <strong style={{ color: text }}>{linkedInCatalogueViewCount}</strong>
              ). Anything hidden by lifecycle or archived filters is out of scope
              here and in the tree.{" "}
              <strong style={{ color: text }}>
                Archived competencies are never included in AI refinement
              </strong>{" "}
              (even if they appear in the catalogue when “Show archived” is on).
            </p>
            <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
              Subject anchors: active-lifecycle subjects (with capability area and
              governance context) — settled/protected subjects are preferred in the
              model.
            </p>
            {analysisError ? (
              <p style={{ margin: 0, fontSize: 13, color: errorColor }}>
                {analysisError}
              </p>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                disabled={
                  analysisLoading ||
                  unassignedCompetencies.length === 0 ||
                  subjectAnchors.length === 0
                }
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
                      Competency
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
                  {sorted.map((c) => {
                    const sug = suggestionByCompetencyId.get(c.id);
                    const d = decisions[c.id] ?? "later";
                    const match = sug
                      ? findSubjectIdByName(subjects, sug.suggested_subject_name)
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
                        key={c.id}
                        style={{
                          borderTop: `1px solid ${borderSubtle}`,
                          backgroundColor: sug?.may_be_subject_instead
                            ? "rgba(212, 168, 75, 0.07)"
                            : undefined,
                        }}
                      >
                        <td style={{ padding: "8px 10px", color: text }}>
                          {c.name.trim()}
                          {c.subject_id &&
                          !subjectIdsInCapabilityTree.has(c.subject_id) ? (
                            <span
                              style={{
                                display: "block",
                                marginTop: 4,
                                fontSize: 11,
                                color: mutedColor,
                              }}
                            >
                              Subject link not in current catalogue view (orphan) —
                              pick a subject below to fix.
                            </span>
                          ) : null}
                          {sug?.may_be_subject_instead ? (
                            <span
                              style={{
                                display: "block",
                                marginTop: 4,
                                fontSize: 11,
                                color: "#d4a84b",
                              }}
                            >
                              May be too broad for a competency (subject-sized?)
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: "8px 10px", color: mutedColor }}>
                          {sug ? (
                            <>
                              {sug.suggested_subject_name}
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
                          {sug?.duplicate_or_merge_note ? (
                            <span style={{ fontSize: 12 }}>
                              {sug.duplicate_or_merge_note}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <select
                            value={d}
                            onChange={(e) =>
                              setDecision(c.id, e.target.value as DecisionValue)
                            }
                            disabled={applyLoading}
                            style={{
                              maxWidth: 260,
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
                            <optgroup label="Existing subjects">
                              {assignableSubjects.map((s) => (
                                <option
                                  key={s.id}
                                  value={`existing:${s.id}` as DecisionValue}
                                >
                                  {s.name.trim()}
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

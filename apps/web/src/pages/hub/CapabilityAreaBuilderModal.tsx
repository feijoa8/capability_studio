import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  analyzeCapabilityAreaGrouping,
  type CapabilityAreaGroupingAiResult,
  type CapabilityAreaGroupSuggestion,
} from "../../lib/capabilityAreaGrouping";
import type {
  CapabilityAreaRow,
  CompetencySubjectRow,
  OrganisationProfileRow,
} from "./types";
import {
  isProtectedGovernance,
  parseTaxonomyGovernanceStatus,
  type TaxonomyGovernanceStatus,
} from "./taxonomyGovernance";
import {
  accent,
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  btnPrimary,
  errorColor,
  muted,
  mutedColor,
  panelShell,
  surface,
  text,
} from "./hubTheme";

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function findSuggestedAreaForSubject(
  groups: CapabilityAreaGroupSuggestion[],
  subjectName: string
): { name: string; description: string | null } | null {
  const k = normalizeNameKey(subjectName);
  for (const g of groups) {
    for (const sn of g.subject_names) {
      if (normalizeNameKey(sn) === k) {
        return {
          name: g.capability_area_name.trim(),
          description: g.capability_area_description?.trim()
            ? g.capability_area_description.trim()
            : null,
        };
      }
    }
  }
  return null;
}

/** Subjects not placed in any AI group (name mismatch). */
function findUnmatchedSubjectNames(
  groups: CapabilityAreaGroupSuggestion[],
  subjectNames: string[]
): string[] {
  const placed = new Set<string>();
  for (const g of groups) {
    for (const sn of g.subject_names) {
      placed.add(normalizeNameKey(sn));
    }
  }
  return subjectNames.filter((n) => !placed.has(normalizeNameKey(n)));
}

export type CapabilityAreaBuilderModalProps = {
  open: boolean;
  onClose: () => void;
  activeOrgId: string;
  subjects: CompetencySubjectRow[];
  capabilityAreas: CapabilityAreaRow[];
  companyProfile: OrganisationProfileRow | null;
  onApplied: () => void | Promise<void>;
};

type Step = "setup" | "review" | "confirm";

type DecisionValue =
  | "keep"
  | "unassigned"
  | "accept"
  | `existing:${string}`
  | `new:${string}`;

export function CapabilityAreaBuilderModal({
  open,
  onClose,
  activeOrgId,
  subjects,
  capabilityAreas,
  companyProfile,
  onApplied,
}: CapabilityAreaBuilderModalProps) {
  const [step, setStep] = useState<Step>("setup");
  const [mode, setMode] = useState<"bottom_up" | "top_down">("bottom_up");
  const [topDownText, setTopDownText] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<CapabilityAreaGroupingAiResult | null>(
    null
  );
  /** subjectId -> decision */
  const [decisions, setDecisions] = useState<Record<string, DecisionValue>>({});
  const [applyLoading, setApplyLoading] = useState(false);

  const subjectRows = useMemo(
    () =>
      [...subjects]
        .filter((s) => s.name?.trim())
        .sort((a, b) => a.name.localeCompare(b.name)),
    [subjects]
  );

  const suggestedBySubjectId = useMemo(() => {
    const m = new Map<string, { name: string; description: string | null }>();
    if (!aiResult) return m;
    for (const s of subjectRows) {
      const sug = findSuggestedAreaForSubject(aiResult.groups, s.name);
      if (sug) m.set(s.id, sug);
    }
    return m;
  }, [aiResult, subjectRows]);

  const unmatchedNames = useMemo(() => {
    if (!aiResult) return [];
    return findUnmatchedSubjectNames(
      aiResult.groups,
      subjectRows.map((s) => s.name)
    );
  }, [aiResult, subjectRows]);

  const activityNameSet = useMemo(() => {
    const s = new Set<string>();
    if (!aiResult) return s;
    for (const a of aiResult.activity_style_subjects) {
      s.add(normalizeNameKey(a.name));
    }
    return s;
  }, [aiResult]);

  const duplicatePairs = aiResult?.possible_duplicates ?? [];

  function resetModal() {
    setStep("setup");
    setMode("bottom_up");
    setTopDownText("");
    setAnalysisLoading(false);
    setAnalysisError(null);
    setAiResult(null);
    setDecisions({});
    setApplyLoading(false);
  }

  function handleClose() {
    resetModal();
    onClose();
  }

  function govOf(s: CompetencySubjectRow): TaxonomyGovernanceStatus {
    return parseTaxonomyGovernanceStatus(s.governance_status);
  }

  async function runAnalysis() {
    setAnalysisError(null);
    setAnalysisLoading(true);
    try {
      const capabilityAreaAnchors = capabilityAreas.map((a) => ({
        name: a.name.trim(),
        governance_status: a.governance_status ?? "draft",
      }));
      const payload = subjectRows.map((s) => {
        const cur = capabilityAreas.find((a) => a.id === s.capability_area_id);
        return {
          id: s.id,
          name: s.name.trim(),
          description: s.description?.trim() ? s.description : null,
          governance_status: govOf(s),
          current_capability_area_name: cur?.name?.trim()
            ? cur.name.trim()
            : null,
        };
      });
      const predefinedAreaNames =
        mode === "top_down"
          ? topDownText
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
          : undefined;
      if (mode === "top_down" && (predefinedAreaNames?.length ?? 0) < 2) {
        setAnalysisError("Enter at least two capability area names (one per line).");
        setAnalysisLoading(false);
        return;
      }
      const result = await analyzeCapabilityAreaGrouping({
        companyProfile,
        subjects: payload,
        capabilityAreaAnchors,
        mode,
        predefinedAreaNames,
      });
      setAiResult(result);
      const next: Record<string, DecisionValue> = {};
      for (const s of subjectRows) {
        const g = govOf(s);
        if (isProtectedGovernance(g)) {
          next[s.id] = "keep";
          continue;
        }
        if (g === "settled") {
          next[s.id] = "keep";
          continue;
        }
        const sug = findSuggestedAreaForSubject(result.groups, s.name);
        next[s.id] = sug ? "accept" : "keep";
      }
      setDecisions(next);
      setStep("review");
    } catch (e) {
      setAnalysisError(
        e instanceof Error ? e.message : "Analysis failed."
      );
    } finally {
      setAnalysisLoading(false);
    }
  }

  function setDecision(subjectId: string, value: DecisionValue) {
    setDecisions((prev) => ({ ...prev, [subjectId]: value }));
  }

  const distinctNewNames = useMemo(() => {
    const set = new Set<string>();
    if (!aiResult) return [];
    for (const g of aiResult.groups) {
      const n = g.capability_area_name.trim();
      if (!n) continue;
      if (
        !capabilityAreas.some(
          (a) => normalizeNameKey(a.name) === normalizeNameKey(n)
        )
      ) {
        set.add(n);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [aiResult, capabilityAreas]);

  const pendingChangesCount = useMemo(() => {
    let n = 0;
    for (const s of subjectRows) {
      if (isProtectedGovernance(parseTaxonomyGovernanceStatus(s.governance_status))) {
        continue;
      }
      const d = decisions[s.id] ?? "keep";
      if (d === "keep") continue;
      const cur = s.capability_area_id ?? null;
      if (d === "unassigned") {
        if (cur !== null) n++;
        continue;
      }
      if (d === "accept") {
        const sug = suggestedBySubjectId.get(s.id);
        if (!sug) continue;
        const match = capabilityAreas.find(
          (a) => normalizeNameKey(a.name) === normalizeNameKey(sug.name)
        );
        if (match) {
          if (match.id !== cur) n++;
        } else {
          n++;
        }
        continue;
      }
      if (d.startsWith("existing:")) {
        const id = d.slice("existing:".length);
        if (id !== cur) n++;
        continue;
      }
      if (d.startsWith("new:")) {
        const raw = d.slice("new:".length);
        const match = capabilityAreas.find(
          (a) => normalizeNameKey(a.name) === normalizeNameKey(raw)
        );
        if (match) {
          if (match.id !== cur) n++;
        } else {
          n++;
        }
      }
    }
    return n;
  }, [decisions, subjectRows, suggestedBySubjectId, capabilityAreas]);

  async function applyChanges() {
    if (!aiResult) return;
    const confirmed = window.confirm(
      `Apply ${pendingChangesCount} subject assignment change(s)? New capability areas will be created when needed. Subjects are not merged or deleted.`
    );
    if (!confirmed) return;

    setApplyLoading(true);
    try {
      const newAreaDescriptions = new Map<string, string | null>();
      for (const g of aiResult.groups) {
        const n = g.capability_area_name.trim();
        if (!n) continue;
        newAreaDescriptions.set(normalizeNameKey(n), g.capability_area_description);
      }

      const createdNameKeyToId = new Map<string, string>();

      async function resolveAreaIdForName(
        areaName: string
      ): Promise<string | null> {
        const k = normalizeNameKey(areaName);
        const existing = capabilityAreas.find(
          (a) => normalizeNameKey(a.name) === k
        );
        if (existing) return existing.id;
        if (createdNameKeyToId.has(k)) return createdNameKeyToId.get(k)!;

        const desc = newAreaDescriptions.get(k) ?? null;
        const { data, error } = await supabase
          .from("capability_areas")
          .insert({
            organisation_id: activeOrgId,
            name: areaName.trim(),
            description: desc,
          })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data?.id) throw new Error("Failed to create capability area.");
        createdNameKeyToId.set(k, data.id);
        return data.id;
      }

      for (const s of subjectRows) {
        if (isProtectedGovernance(parseTaxonomyGovernanceStatus(s.governance_status))) {
          continue;
        }
        const d = decisions[s.id] ?? "keep";
        if (d === "keep") continue;

        let nextCapId: string | null = null;

        if (d === "unassigned") {
          nextCapId = null;
        } else if (d === "accept") {
          const sug = suggestedBySubjectId.get(s.id);
          if (!sug) continue;
          const id = await resolveAreaIdForName(sug.name);
          nextCapId = id;
        } else if (d.startsWith("existing:")) {
          nextCapId = d.slice("existing:".length) || null;
        } else if (d.startsWith("new:")) {
          const raw = d.slice("new:".length);
          const id = await resolveAreaIdForName(raw);
          nextCapId = id;
        }

        const current = s.capability_area_id ?? null;
        if (nextCapId === current) continue;

        const { error: uErr } = await supabase
          .from("competency_subjects")
          .update({ capability_area_id: nextCapId })
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

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="cap-area-builder-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 92,
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
          ...panelShell,
          width: "100%",
          maxWidth: 720,
          marginTop: 32,
          maxHeight: "min(90vh, 880px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="cap-area-builder-title"
          style={{
            margin: "0 0 8px",
            fontSize: 17,
            fontWeight: 600,
            color: text,
          }}
        >
          Manage Capability Areas
        </h2>
        <p style={{ ...muted, margin: "0 0 14px", fontSize: 13, lineHeight: 1.45 }}>
          AI-assisted, review-driven workflow. Nothing is saved until you confirm.
          Only subject → capability area assignments are updated; subjects are not
          merged or deleted.
        </p>

        {step === "setup" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <fieldset
              style={{
                margin: 0,
                padding: 0,
                border: "none",
                display: "grid",
                gap: 8,
              }}
            >
              <legend
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: text,
                  marginBottom: 4,
                }}
              >
                Mode
              </legend>
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
                  type="radio"
                  name="capAreaMode"
                  checked={mode === "bottom_up"}
                  onChange={() => setMode("bottom_up")}
                  disabled={analysisLoading}
                />
                Bottom-up — AI proposes capability areas from your subjects
              </label>
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
                  type="radio"
                  name="capAreaMode"
                  checked={mode === "top_down"}
                  onChange={() => setMode("top_down")}
                  disabled={analysisLoading}
                />
                Top-down — you define areas first; AI maps each subject
              </label>
            </fieldset>
            {mode === "top_down" ? (
              <label
                style={{
                  display: "grid",
                  gap: 6,
                  fontSize: 13,
                  color: mutedColor,
                }}
              >
                Capability area names (one per line)
                <textarea
                  value={topDownText}
                  onChange={(e) => setTopDownText(e.target.value)}
                  disabled={analysisLoading}
                  rows={5}
                  placeholder={"e.g. Engineering delivery\nPeople & leadership\nData & platforms"}
                  style={{
                    padding: "10px 12px",
                    fontSize: 14,
                    color: text,
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    fontFamily: "inherit",
                    resize: "vertical" as const,
                  }}
                />
              </label>
            ) : null}
            <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
              Analysing {subjectRows.length} subject(s). Names and descriptions are
              sent to the model.
            </p>
            {analysisError ? (
              <p style={{ margin: 0, fontSize: 13, color: errorColor }}>
                {analysisError}
              </p>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                disabled={analysisLoading || subjectRows.length === 0}
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

        {step === "review" && aiResult ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              flex: 1,
              minHeight: 0,
            }}
          >
            {(duplicatePairs.length > 0 ||
              aiResult.activity_style_subjects.length > 0 ||
              unmatchedNames.length > 0) && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${borderSubtle}`,
                  backgroundColor: "rgba(212, 168, 75, 0.08)",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: accent }}>Clean-up signals (non-blocking)</strong>
                {unmatchedNames.length > 0 ? (
                  <p style={{ margin: "6px 0 0" }}>
                    Some subjects were not matched to an AI group (name mismatch):{" "}
                    {unmatchedNames.join(", ")} — left as &quot;Keep unchanged&quot;
                    unless you assign manually.
                  </p>
                ) : null}
                {duplicatePairs.length > 0 ? (
                  <p style={{ margin: "8px 0 0" }}>
                    Possible duplicates:{" "}
                    {duplicatePairs.map((p, i) => (
                      <span key={i}>
                        {p.name_a} / {p.name_b}
                        {p.note ? ` (${p.note})` : ""}
                        {i < duplicatePairs.length - 1 ? "; " : ""}
                      </span>
                    ))}
                  </p>
                ) : null}
                {aiResult.activity_style_subjects.length > 0 ? (
                  <p style={{ margin: "8px 0 0" }}>
                    Activity-style names:{" "}
                    {aiResult.activity_style_subjects.map((a, i) => (
                      <span key={i}>
                        {a.name}
                        {a.note ? ` (${a.note})` : ""}
                        {i < aiResult.activity_style_subjects.length - 1
                          ? "; "
                          : ""}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            )}

            <p style={{ margin: 0, fontSize: 12, color: mutedColor, lineHeight: 1.5 }}>
              Settled items are treated as stable anchors in AI-assisted review. Protected
              items are not changed by AI suggestions — decisions stay locked unless you
              change governance outside this flow.
            </p>

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
                      Current area
                    </th>
                    <th style={{ padding: "8px 10px", color: mutedColor }}>
                      AI suggestion
                    </th>
                    <th style={{ padding: "8px 10px", color: mutedColor }}>
                      Decision
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {subjectRows.map((s) => {
                    const cur = capabilityAreas.find(
                      (a) => a.id === s.capability_area_id
                    );
                    const sug = suggestedBySubjectId.get(s.id);
                    const d = decisions[s.id] ?? "keep";
                    const isActivity = activityNameSet.has(
                      normalizeNameKey(s.name)
                    );
                    const g = govOf(s);
                    const isProt = isProtectedGovernance(g);
                    const isSettled = g === "settled";
                    const aiSuggestionCell = isProt ? (
                      <span style={{ fontStyle: "italic", opacity: 0.85 }}>
                        — (protected; not assigned by AI)
                      </span>
                    ) : isSettled ? (
                      <span style={{ fontStyle: "italic", opacity: 0.85 }}>
                        {sug?.name ?? "—"}{" "}
                        <span style={{ fontSize: 11 }}>
                          (reference only — use manual assignment if needed)
                        </span>
                      </span>
                    ) : (
                      (sug?.name ?? "—")
                    );
                    return (
                      <tr
                        key={s.id}
                        style={{
                          borderTop: `1px solid ${borderSubtle}`,
                          backgroundColor: isActivity
                            ? "rgba(212, 168, 75, 0.06)"
                            : isProt
                              ? "rgba(80, 80, 100, 0.08)"
                              : undefined,
                        }}
                      >
                        <td style={{ padding: "8px 10px", color: text }}>
                          {s.name.trim()}
                          {isActivity ? (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                color: "#d4a84b",
                              }}
                            >
                              activity?
                            </span>
                          ) : null}
                        </td>
                        <td style={{ padding: "8px 10px", color: mutedColor }}>
                          {cur?.name?.trim() || "— Unassigned —"}
                        </td>
                        <td style={{ padding: "8px 10px", color: mutedColor }}>
                          {aiSuggestionCell}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <select
                            value={d}
                            onChange={(e) =>
                              setDecision(s.id, e.target.value as DecisionValue)
                            }
                            disabled={applyLoading || isProt}
                            style={{
                              maxWidth: 240,
                              padding: "6px 8px",
                              fontSize: 13,
                              borderRadius: 6,
                              border: `1px solid ${border}`,
                              backgroundColor: bg,
                              color: text,
                              opacity: isProt ? 0.75 : 1,
                            }}
                          >
                            <option value="keep">
                              {isProt
                                ? "Keep unchanged (protected)"
                                : "Keep unchanged"}
                            </option>
                            {!isProt ? (
                              <option value="unassigned">Set unassigned</option>
                            ) : null}
                            {!isProt && sug && !isSettled ? (
                              <option value="accept">
                                Accept AI suggestion
                              </option>
                            ) : null}
                            {!isProt ? (
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
                            ) : null}
                            {!isProt && distinctNewNames.length > 0 ? (
                              <optgroup label="Create from AI name">
                                {distinctNewNames.map((n) => (
                                  <option
                                    key={n}
                                    value={`new:${n}` as DecisionValue}
                                  >
                                    Create: {n}
                                  </option>
                                ))}
                              </optgroup>
                            ) : null}
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
                  setAiResult(null);
                }}
                style={btnGhost}
              >
                Back
              </button>
              <button
                type="button"
                disabled={applyLoading || pendingChangesCount === 0}
                onClick={() => void applyChanges()}
                style={btnPrimary}
              >
                {applyLoading
                  ? "Applying…"
                  : `Apply changes (${pendingChangesCount})`}
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

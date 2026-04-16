import { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  analyzePracticeCoverage,
  type PracticeCoverageLinkExisting,
  type PracticeCoverageMissingArea,
} from "../../lib/practiceCoverageRefinement";
import type {
  CapabilityAreaRow,
  CompetencyPracticeRow,
  CompetencySubjectRow,
  OrganisationProfileRow,
} from "./types";
import { isAssignableLifecycleStatus } from "./competencyLifecycle";
import {
  addSubjectPracticeLink,
  practiceIdsForSubjectDisplay,
  subjectIsRelevantToPractice,
  type SubjectPracticeLinkRow,
} from "./subjectPracticeLinks";
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

function findSimilarSubjectsLocal(
  name: string,
  catalogue: CompetencySubjectRow[]
): CompetencySubjectRow[] {
  const t = name.trim().toLowerCase();
  if (t.length < 2) return [];
  const seen = new Set<string>();
  const out: CompetencySubjectRow[] = [];
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const wt = words(t);
  for (const s of catalogue) {
    const cn = s.name.trim().toLowerCase();
    if (cn.length < 2) continue;
    let match = false;
    if (cn === t) match = true;
    else if (cn.includes(t) || t.includes(cn)) match = true;
    else {
      const wn = words(cn);
      let overlap = 0;
      for (const w of wt) {
        if (wn.has(w)) overlap++;
      }
      if (wt.size > 0 && overlap / wt.size >= 0.5) match = true;
    }
    if (match && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out.slice(0, 12);
}

function normKey(s: string): string {
  return s.trim().toLowerCase();
}

function resolveCapabilityAreaIdByName(
  areas: CapabilityAreaRow[],
  name: string | null
): string | null {
  if (!name?.trim()) return null;
  const k = normKey(name);
  const a = areas.find((x) => normKey(x.name) === k);
  return a?.id ?? null;
}

export type PracticeCoverageRefinementModalProps = {
  open: boolean;
  onClose: () => void;
  practice: CompetencyPracticeRow | null;
  subjects: CompetencySubjectRow[];
  subjectPracticeLinks: SubjectPracticeLinkRow[];
  capabilityAreas: CapabilityAreaRow[];
  companyProfile: OrganisationProfileRow | null;
  activeOrgId: string | null;
  onApplied: () => Promise<void>;
};

type Step = "setup" | "review";

type LinkDecision = "later" | "ignore" | "mark";

type MissingDecision =
  | "later"
  | "discard"
  | "create"
  | `existing:${string}`;

export function PracticeCoverageRefinementModal({
  open,
  onClose,
  practice,
  subjects,
  subjectPracticeLinks,
  capabilityAreas,
  companyProfile,
  activeOrgId,
  onApplied,
}: PracticeCoverageRefinementModalProps) {
  const [step, setStep] = useState<Step>("setup");
  const [loading, setLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkRows, setLinkRows] = useState<PracticeCoverageLinkExisting[]>([]);
  const [missingRows, setMissingRows] = useState<PracticeCoverageMissingArea[]>(
    []
  );
  const [linkDecisions, setLinkDecisions] = useState<
    Record<string, LinkDecision>
  >({});
  const [missingDecisions, setMissingDecisions] = useState<
    Record<number, MissingDecision>
  >({});

  const subjectById = useMemo(() => {
    const m = new Map<string, CompetencySubjectRow>();
    for (const s of subjects) m.set(s.id, s);
    return m;
  }, [subjects]);

  const assignableSubjects = useMemo(() => {
    return [...subjects]
      .filter((s) => isAssignableLifecycleStatus(s.status))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [subjects]);

  function reset() {
    setStep("setup");
    setLoading(false);
    setApplyLoading(false);
    setError(null);
    setLinkRows([]);
    setMissingRows([]);
    setLinkDecisions({});
    setMissingDecisions({});
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function runAnalysis() {
    if (!practice || activeOrgId === null) return;
    setError(null);
    setLoading(true);
    try {
      const payloadSubjects = subjects.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        description: s.description?.trim() ? s.description : null,
        type: s.type ?? null,
        practice_id: s.practice_id ?? null,
        practice_context_ids: practiceIdsForSubjectDisplay(
          subjectPracticeLinks,
          s.id,
          s.practice_id
        ),
        governance_status: s.governance_status?.trim() ?? null,
        capability_area_id: s.capability_area_id ?? null,
      }));
      const payloadAreas = capabilityAreas.map((a) => ({
        id: a.id,
        name: a.name.trim(),
        description: a.description?.trim() ? a.description : null,
        governance_status: a.governance_status?.trim() ?? null,
      }));
      const result = await analyzePracticeCoverage({
        companyProfile,
        practice: {
          id: practice.id,
          name: practice.name.trim(),
          description: practice.description?.trim()
            ? practice.description.trim()
            : null,
        },
        subjects: payloadSubjects,
        capabilityAreas: payloadAreas,
      });
      setLinkRows(result.link_existing);
      setMissingRows(result.missing_areas);
      const nextLink: Record<string, LinkDecision> = {};
      for (const r of result.link_existing) {
        nextLink[r.subject_id] = "later";
      }
      setLinkDecisions(nextLink);
      const nextMiss: Record<number, MissingDecision> = {};
      result.missing_areas.forEach((_, i) => {
        nextMiss[i] = "later";
      });
      setMissingDecisions(nextMiss);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  async function applyLink(subjectId: string): Promise<boolean> {
    if (!practice || activeOrgId === null) return false;
    const row = subjects.find((s) => s.id === subjectId);
    if (!row) return false;
    if (
      subjectIsRelevantToPractice(
        subjectPracticeLinks,
        subjectId,
        practice.id,
        row
      )
    ) {
      return true;
    }
    const { error } = await addSubjectPracticeLink(
      activeOrgId,
      subjectId,
      practice.id
    );
    if (error) {
      alert(error.message || "Could not add practice link.");
      return false;
    }
    return true;
  }

  async function createMissingSubject(
    m: PracticeCoverageMissingArea
  ): Promise<boolean> {
    if (!practice || activeOrgId === null) return false;
    const name = m.proposed_name.trim();
    if (!name) return false;
    const similar = findSimilarSubjectsLocal(name, subjects);
    if (similar.length > 0) {
      const line = similar
        .slice(0, 5)
        .map((s) => `• ${s.name.trim()}`)
        .join("\n");
      const useExisting = window.confirm(
        `Similar subjects already exist:\n\n${line}\n\nCancel creation and link an existing subject instead?`
      );
      if (useExisting) return false;
    }
    const capId = resolveCapabilityAreaIdByName(
      capabilityAreas,
      m.suggested_capability_area_name
    );
    const { data: created, error: insErr } = await supabase
      .from("competency_subjects")
      .insert({
        organisation_id: activeOrgId,
        name,
        description: m.proposed_description?.trim()
          ? m.proposed_description.trim()
          : null,
        category: null,
        type: "practice",
        practice_id: null,
        capability_area_id: capId,
        is_active: true,
        status: "active",
      })
      .select("id")
      .maybeSingle();
    if (insErr || !created?.id) {
      alert(insErr?.message || "Could not create subject.");
      return false;
    }
    const { error: linkErr } = await addSubjectPracticeLink(
      activeOrgId,
      created.id,
      practice.id
    );
    if (linkErr) {
      alert(linkErr.message || "Subject created but practice link failed.");
      return false;
    }
    return true;
  }

  async function linkExistingToPractice(subjectId: string): Promise<boolean> {
    return applyLink(subjectId);
  }

  async function applyChanges() {
    if (!practice || activeOrgId === null) return;
    const linkCount = Object.entries(linkDecisions).filter(
      ([id, d]) => d === "mark" && linkRows.some((r) => r.subject_id === id)
    ).length;
    const missingCreates = missingRows.filter(
      (_, i) => missingDecisions[i] === "create"
    ).length;
    const missingLinks = missingRows.filter((_, i) => {
      const d = missingDecisions[i];
      return typeof d === "string" && d.startsWith("existing:");
    }).length;
    const n = linkCount + missingCreates + missingLinks;
    if (n === 0) {
      alert("No changes selected — choose “Mark relevant”, create, or link.");
      return;
    }
    if (
      !window.confirm(
        `Apply ${n} change(s) to practice coverage? Nothing else is modified.`
      )
    ) {
      return;
    }
    setApplyLoading(true);
    try {
      for (const r of linkRows) {
        if (linkDecisions[r.subject_id] !== "mark") continue;
        const ok = await applyLink(r.subject_id);
        if (!ok) break;
      }
      for (let i = 0; i < missingRows.length; i++) {
        const d = missingDecisions[i] ?? "later";
        if (d === "create") {
          const ok = await createMissingSubject(missingRows[i]!);
          if (!ok) break;
        } else if (typeof d === "string" && d.startsWith("existing:")) {
          const sid = d.slice("existing:".length);
          if (sid) {
            const ok = await linkExistingToPractice(sid);
            if (!ok) break;
          }
        }
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

  if (!open || !practice) return null;

  const confColor = (c: string) =>
    c === "high" ? "#6bca7a" : c === "low" ? "#c9a227" : mutedColor;

  const pendingApplyCount =
    linkRows.filter((r) => linkDecisions[r.subject_id] === "mark").length +
    missingRows.filter((_, i) => {
      const d = missingDecisions[i];
      return d === "create" || (typeof d === "string" && d.startsWith("existing:"));
    }).length;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="practice-coverage-refine-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 94,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
        overflow: "auto",
        backgroundColor: "rgba(0,0,0,0.65)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading && !applyLoading) {
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
          id="practice-coverage-refine-title"
          style={{
            margin: "0 0 8px",
            fontSize: 18,
            fontWeight: 700,
            color: text,
          }}
        >
          Refine practice coverage
        </h2>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            color: mutedColor,
            lineHeight: 1.45,
          }}
        >
          Review and strengthen which subjects are <strong style={{ color: text }}>relevant</strong>{" "}
          to <strong style={{ color: text }}>{practice.name.trim()}</strong> (context
          only — practices do not own the taxonomy). Nothing is saved until you
          apply.
        </p>

        {step === "setup" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
              AI compares this practice to your full subject catalogue, capability
              areas, and governance anchors. You keep control: mark links, ignore
              suggestions, or create subjects only when you explicitly choose to.
            </p>
            {error ? (
              <p style={{ margin: 0, fontSize: 13, color: errorColor }}>
                {error}
              </p>
            ) : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="button"
                disabled={loading || subjects.length === 0}
                onClick={() => void runAnalysis()}
                style={btnPrimary}
              >
                {loading ? "Analysing…" : "Run AI analysis"}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleClose}
                style={btn}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {step === "review" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              flex: 1,
              minHeight: 0,
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
              <strong style={{ color: text }}>A.</strong> Existing subjects to link
              · <strong style={{ color: text }}>B.</strong> Possible new subject
              areas (only if needed)
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
                      A · Subject
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
                  {linkRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "10px",
                          color: mutedColor,
                          borderTop: `1px solid ${borderSubtle}`,
                        }}
                      >
                        No additional existing subjects suggested — check section
                        B for gaps, or adjust the catalogue.
                      </td>
                    </tr>
                  ) : (
                    linkRows.map((r) => {
                      const sub = subjectById.get(r.subject_id);
                      const d = linkDecisions[r.subject_id] ?? "later";
                      return (
                        <tr
                          key={r.subject_id}
                          style={{
                            borderTop: `1px solid ${borderSubtle}`,
                          }}
                        >
                          <td style={{ padding: "8px 10px", color: text }}>
                            {sub?.name.trim() ?? r.subject_id}
                            {r.duplicate_or_close_match_note ? (
                              <span
                                style={{
                                  display: "block",
                                  marginTop: 4,
                                  fontSize: 11,
                                  color: mutedColor,
                                }}
                              >
                                {r.duplicate_or_close_match_note}
                              </span>
                            ) : null}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              color: confColor(r.confidence),
                            }}
                          >
                            {r.confidence}
                          </td>
                          <td style={{ padding: "8px 10px", color: mutedColor }}>
                            {r.reason}
                          </td>
                          <td style={{ padding: "6px 10px" }}>
                            <select
                              value={d}
                              onChange={(e) =>
                                setLinkDecisions((prev) => ({
                                  ...prev,
                                  [r.subject_id]: e.target.value as LinkDecision,
                                }))
                              }
                              disabled={applyLoading}
                              style={{
                                maxWidth: 220,
                                padding: "6px 8px",
                                fontSize: 13,
                                borderRadius: 6,
                                border: `1px solid ${border}`,
                                backgroundColor: bg,
                                color: text,
                              }}
                            >
                              <option value="later">Review later</option>
                              <option value="ignore">Ignore suggestion</option>
                              <option value="mark">Mark relevant to practice</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                overflow: "auto",
                maxHeight: 280,
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
                      B · Proposed area
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
                  {missingRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          padding: "10px",
                          color: mutedColor,
                          borderTop: `1px solid ${borderSubtle}`,
                        }}
                      >
                        No gap proposals — existing subjects may be sufficient.
                      </td>
                    </tr>
                  ) : (
                    missingRows.map((m, i) => {
                      const d = missingDecisions[i] ?? "later";
                      return (
                        <tr
                          key={`m-${i}-${m.proposed_name}`}
                          style={{
                            borderTop: `1px solid ${borderSubtle}`,
                          }}
                        >
                          <td style={{ padding: "8px 10px", color: text }}>
                            <strong>{m.proposed_name.trim()}</strong>
                            {m.suggested_capability_area_name ? (
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 11,
                                  color: mutedColor,
                                  marginTop: 4,
                                }}
                              >
                                Capability area: {m.suggested_capability_area_name}
                              </span>
                            ) : null}
                            {m.duplicate_or_close_match_note ? (
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 11,
                                  color: "#c9a227",
                                  marginTop: 4,
                                }}
                              >
                                {m.duplicate_or_close_match_note}
                              </span>
                            ) : null}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              color: confColor(m.confidence),
                            }}
                          >
                            {m.confidence}
                          </td>
                          <td style={{ padding: "8px 10px", color: mutedColor }}>
                            {m.reason}
                          </td>
                          <td style={{ padding: "6px 10px" }}>
                            <select
                              value={
                                typeof d === "string" && d.startsWith("existing:")
                                  ? d
                                  : d
                              }
                              onChange={(e) => {
                                const v = e.target.value as MissingDecision;
                                setMissingDecisions((prev) => ({
                                  ...prev,
                                  [i]: v,
                                }));
                              }}
                              disabled={applyLoading}
                              style={{
                                maxWidth: 280,
                                padding: "6px 8px",
                                fontSize: 13,
                                borderRadius: 6,
                                border: `1px solid ${border}`,
                                backgroundColor: bg,
                                color: text,
                              }}
                            >
                              <option value="later">Review later</option>
                              <option value="discard">Discard proposal</option>
                              <option value="create">
                                Create new subject (confirm on apply)
                              </option>
                              <optgroup label="Link existing instead">
                                {assignableSubjects.map((s) => (
                                  <option
                                    key={s.id}
                                    value={`existing:${s.id}` as MissingDecision}
                                  >
                                    Use: {s.name.trim()}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                      );
                    })
                  )}
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
                  setLinkRows([]);
                  setMissingRows([]);
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
                  : `Apply selected (${pendingApplyCount})`}
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

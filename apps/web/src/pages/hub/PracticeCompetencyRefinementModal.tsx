import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import { insertDefaultCompetencyLevels } from "../../lib/insertDefaultCompetencyLevels";
import {
  buildPracticeCompetencyRefinementRequest,
  refinePracticeCompetencies,
  type PracticeCompetencyRefinementResponse,
} from "../../lib/practiceCompetencyRefinement";
import {
  adoptReferenceCompetencyToOrganisation,
  fetchReferenceTaxonomyPayload,
} from "../../lib/referenceLibrary";
import type {
  CapabilityAreaRow,
  CompetencyPracticeRow,
  CompetencyRow,
  CompetencySubjectRow,
  CompetencyType,
  OrganisationProfileRow,
} from "./types";
import { isAssignableLifecycleStatus } from "./competencyLifecycle";
import { addSubjectPracticeLink } from "./subjectPracticeLinks";
import {
  addCompetencyPracticeLink,
  competencyLinkedToPractice,
  type CompetencyPracticeLinkRow,
} from "./competencyPracticeLinks";
import {
  subjectIsRelevantToPractice,
  type SubjectPracticeLinkRow,
} from "./subjectPracticeLinks";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnPrimary,
  btnSecondary,
  errorColor,
  mutedColor,
  surface,
  text,
} from "./hubTheme";

function normKey(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeCompetencyType(type?: string | null): string {
  return (type || "").toLowerCase().trim();
}

function toCompetencyTypeUnion(normalized: string): CompetencyType {
  if (
    normalized === "organisation" ||
    normalized === "stretch" ||
    normalized === "practice"
  ) {
    return normalized;
  }
  return "practice";
}

function normalizeSubjectTypeForAlignment(
  subject: CompetencySubjectRow | undefined,
): string {
  return normalizeCompetencyType(subject?.type);
}

function resolveCompetencyTypeForSubject(
  subjectId: string | null,
  preferredType: CompetencyType,
  subjectsList: CompetencySubjectRow[],
): CompetencyType {
  let resolvedCompetencyType = preferredType;
  if (subjectId) {
    const subject = subjectsList.find((s) => s.id === subjectId);
    const subjectType = normalizeSubjectTypeForAlignment(subject);
    const competencyTypeNorm = normalizeCompetencyType(resolvedCompetencyType);
    if (subjectType && subjectType !== competencyTypeNorm) {
      resolvedCompetencyType = toCompetencyTypeUnion(subjectType);
    }
  }
  return resolvedCompetencyType;
}

function findExactCompetencyOnSubject(
  name: string,
  subjectId: string,
  list: CompetencyRow[],
): CompetencyRow | null {
  const k = normKey(name);
  if (!k) return null;
  return (
    list.find(
      (c) =>
        c.subject_id === subjectId &&
        isAssignableLifecycleStatus(c.status) &&
        normKey(c.name) === k,
    ) ?? null
  );
}

function badgeStyle(kind: "org" | "ref" | "sug"): CSSProperties {
  const colors = {
    org: { bg: "#e8f4fd", fg: "#0b5cab", border: "#b3d7f5" },
    ref: { bg: "#f3e8ff", fg: "#5b21b6", border: "#d8b4fe" },
    sug: { bg: "#fff7ed", fg: "#9a3412", border: "#fdba74" },
  }[kind];
  return {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    padding: "2px 8px",
    borderRadius: 999,
    backgroundColor: colors.bg,
    color: colors.fg,
    border: `1px solid ${colors.border}`,
  };
}

export type PracticeCompetencyRefinementModalProps = {
  open: boolean;
  onClose: () => void;
  practice: CompetencyPracticeRow | null;
  subjects: CompetencySubjectRow[];
  competencies: CompetencyRow[];
  capabilityAreas: CapabilityAreaRow[];
  companyProfile: OrganisationProfileRow | null;
  activeOrgId: string | null;
  canAuthorHierarchy: boolean;
  subjectPracticeLinks: SubjectPracticeLinkRow[];
  competencyPracticeLinks: CompetencyPracticeLinkRow[];
  onApplied: () => Promise<void>;
};

type Step = "setup" | "review";

type MissingRowAction = "create_and_link" | "create_only";

type LoadingStage = "analyse" | "org" | "reference" | "gaps" | null;

const STAGE_LABEL: Record<NonNullable<LoadingStage>, string> = {
  analyse: "Analysing practice…",
  org: "Matching organisation competencies…",
  reference: "Checking reference library…",
  gaps: "Identifying gaps…",
};

export function PracticeCompetencyRefinementModal({
  open,
  onClose,
  practice,
  subjects,
  competencies,
  capabilityAreas,
  companyProfile,
  activeOrgId,
  canAuthorHierarchy,
  subjectPracticeLinks,
  competencyPracticeLinks,
  onApplied,
}: PracticeCompetencyRefinementModalProps) {
  const [step, setStep] = useState<Step>("setup");
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PracticeCompetencyRefinementResponse | null>(
    null,
  );
  const [referenceFrameworkDraft, setReferenceFrameworkDraft] = useState("");
  const [subjectLinkChecked, setSubjectLinkChecked] = useState<boolean[]>([]);
  const [competencyLinkChecked, setCompetencyLinkChecked] = useState<boolean[]>(
    [],
  );
  const [referenceAdoptChecked, setReferenceAdoptChecked] = useState<boolean[]>(
    [],
  );
  const [missingInclude, setMissingInclude] = useState<boolean[]>([]);
  const [missingAction, setMissingAction] = useState<MissingRowAction[]>([]);
  const [missingSubjectChoice, setMissingSubjectChoice] = useState<string[]>([]);
  const [applySummary, setApplySummary] = useState<string[] | null>(null);

  useEffect(() => {
    if (open && practice) {
      setReferenceFrameworkDraft(practice.reference_framework?.trim() ?? "");
    }
  }, [open, practice?.id, practice?.reference_framework]);

  useEffect(() => {
    if (!open) {
      setStep("setup");
      setLoading(false);
      setLoadingStage(null);
      setApplying(false);
      setError(null);
      setResult(null);
      setSubjectLinkChecked([]);
      setCompetencyLinkChecked([]);
      setReferenceAdoptChecked([]);
      setMissingInclude([]);
      setMissingAction([]);
      setMissingSubjectChoice([]);
      setApplySummary(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !result) return;
    setSubjectLinkChecked(result.relevant_subjects.map(() => false));
    setCompetencyLinkChecked(result.relevant_competencies.map(() => false));
    setReferenceAdoptChecked(result.reference_competencies.map(() => false));
    setMissingInclude(result.missing_competencies.map(() => false));
    setMissingAction(result.missing_competencies.map(() => "create_and_link"));
    setMissingSubjectChoice(
      result.missing_competencies.map((m) => m.subject_id),
    );
  }, [open, result]);

  const assignableSubjects = subjects.filter((s) =>
    isAssignableLifecycleStatus(s.status),
  );

  async function runReview() {
    if (!practice || !activeOrgId) return;
    setLoading(true);
    setLoadingStage("analyse");
    setError(null);
    try {
      if (canAuthorHierarchy) {
        const fw = referenceFrameworkDraft.trim() || null;
        const { error: upErr } = await supabase
          .from("competency_practices")
          .update({ reference_framework: fw })
          .eq("id", practice.id)
          .eq("organisation_id", activeOrgId);
        if (upErr) {
          throw new Error(upErr.message || "Could not save reference framework.");
        }
      }

      await new Promise((r) => setTimeout(r, 120));
      setLoadingStage("org");

      const fwHint =
        referenceFrameworkDraft.trim() ||
        practice.reference_framework?.trim() ||
        null;
      const refTree = await fetchReferenceTaxonomyPayload(supabase, fwHint);

      await new Promise((r) => setTimeout(r, 120));
      setLoadingStage("reference");

      const body = buildPracticeCompetencyRefinementRequest({
        practice,
        capabilityAreas,
        subjects,
        competencies,
        companyProfile,
        referenceFrameworkDraft: referenceFrameworkDraft.trim() || null,
        referenceCapabilityAreas:
          refTree.length > 0 ? refTree : undefined,
      });

      if (body.capabilityAreas.length === 0) {
        throw new Error(
          "No capability areas with active competency_subjects to review.",
        );
      }

      setLoadingStage("gaps");
      const res = await refinePracticeCompetencies(body, subjects, competencies);
      setResult(res);
      setStep("review");
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed.");
    } finally {
      setLoading(false);
      setLoadingStage(null);
    }
  }

  async function handleApply() {
    if (!practice || !activeOrgId || !result || !canAuthorHierarchy) return;
    setApplying(true);
    setError(null);
    const lines: string[] = [];
    let linksSubjects = 0;
    let linksCompetencies = 0;
    let adoptedRef = 0;
    let linkedAfterAdopt = 0;
    let createdCompetencies = 0;
    let linkedNewCompetencies = 0;
    let skippedDuplicates = 0;

    try {
      const workingComps = [...competencies];

      for (let i = 0; i < result.relevant_subjects.length; i++) {
        if (!subjectLinkChecked[i]) continue;
        const row = result.relevant_subjects[i]!;
        const { error: err } = await addSubjectPracticeLink(
          activeOrgId,
          row.subject_id,
          practice.id,
        );
        if (err) {
          lines.push(`Subject link ${row.subject_name}: ${err.message}`);
        } else {
          linksSubjects++;
        }
      }

      for (let i = 0; i < result.relevant_competencies.length; i++) {
        if (!competencyLinkChecked[i]) continue;
        const row = result.relevant_competencies[i]!;
        const { error: err } = await addCompetencyPracticeLink(
          activeOrgId,
          row.competency_id,
          practice.id,
        );
        if (err) {
          lines.push(`Competency link ${row.competency_name}: ${err.message}`);
        } else {
          linksCompetencies++;
        }
      }

      for (let i = 0; i < result.reference_competencies.length; i++) {
        if (!referenceAdoptChecked[i]) continue;
        const row = result.reference_competencies[i]!;
        try {
          const r = await adoptReferenceCompetencyToOrganisation(
            supabase,
            row.reference_competency_id,
            activeOrgId,
            capabilityAreas,
            null,
          );
          if (r.created) adoptedRef++;
          const { error: le } = await addCompetencyPracticeLink(
            activeOrgId,
            r.competencyId,
            practice.id,
          );
          if (le) {
            lines.push(`Link after adopt “${row.reference_competency_name}”: ${le.message}`);
          } else {
            linkedAfterAdopt++;
          }
          const fresh = await supabase
            .from("competencies")
            .select(
              "id, name, description, competency_type, subject_id, is_active, status",
            )
            .eq("id", r.competencyId)
            .maybeSingle();
          if (fresh.data) {
            workingComps.push(fresh.data as CompetencyRow);
          }
        } catch (e) {
          lines.push(
            `Adopt “${row.reference_competency_name}”: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      for (let i = 0; i < result.missing_competencies.length; i++) {
        if (!missingInclude[i]) continue;
        const dec = missingAction[i] ?? "create_and_link";
        const row = result.missing_competencies[i]!;
        const subjectId = (missingSubjectChoice[i] ?? row.subject_id).trim();
        const name = row.name.trim();
        if (!subjectId || !name) continue;
        const subj = subjects.find((s) => s.id === subjectId);
        if (!subj || !isAssignableLifecycleStatus(subj.status)) {
          lines.push(`Skipped “${name}”: competency_subject not found or not active.`);
          continue;
        }

        const existing = findExactCompetencyOnSubject(
          name,
          subjectId,
          workingComps,
        );
        if (existing) {
          skippedDuplicates++;
          if (dec === "create_and_link") {
            const { error: le } = await addCompetencyPracticeLink(
              activeOrgId,
              existing.id,
              practice.id,
            );
            if (le) {
              lines.push(`Link existing “${existing.name}”: ${le.message}`);
            } else {
              linkedNewCompetencies++;
            }
          }
          continue;
        }

        const resolvedType = resolveCompetencyTypeForSubject(
          subjectId,
          "practice",
          subjects,
        );

        const { data: inserted, error: insErr } = await supabase
          .from("competencies")
          .insert({
            organisation_id: activeOrgId,
            name,
            description: null,
            competency_type: resolvedType,
            is_active: true,
            subject_id: subjectId,
            status: "active",
            origin_type: "native",
          })
          .select("id")
          .single();

        if (insErr || !inserted) {
          lines.push(
            `Create “${name}”: ${insErr?.message ?? "insert failed"}`,
          );
          continue;
        }

        createdCompetencies++;
        workingComps.push({
          id: inserted.id,
          name,
          description: null,
          competency_type: resolvedType,
          subject_id: subjectId,
          is_active: true,
          status: "active",
          origin_type: "native",
        } as CompetencyRow);

        const { error: lvlErr } = await insertDefaultCompetencyLevels(
          supabase,
          inserted.id,
        );
        if (lvlErr) {
          lines.push(
            `Levels for “${name}”: ${lvlErr.message ?? "could not add defaults"}`,
          );
        }

        if (dec === "create_and_link") {
          const { error: le } = await addCompetencyPracticeLink(
            activeOrgId,
            inserted.id,
            practice.id,
          );
          if (le) {
            lines.push(`Link new “${name}”: ${le.message}`);
          } else {
            linkedNewCompetencies++;
          }
        }
      }

      lines.unshift(
        `Linked ${linksSubjects} competency_subject(s) and ${linksCompetencies} organisation competency(ies) to this practice.`,
        `Reference: adopted ${adoptedRef} shared competency(ies); ${linkedAfterAdopt} linked to practice.`,
        `New org competencies: created ${createdCompetencies}; ${linkedNewCompetencies} linked; ${skippedDuplicates} duplicate name(s) reused or linked only.`,
      );
      setApplySummary(lines);
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed.");
    } finally {
      setApplying(false);
    }
  }

  if (!open || !practice) return null;

  const orgSubjectCount = result?.relevant_subjects.length ?? 0;
  const orgCompCount = result?.relevant_competencies.length ?? 0;
  const refCount = result?.reference_competencies.length ?? 0;
  const missCount = result?.missing_competencies.length ?? 0;
  const totalSuggestions = orgSubjectCount + orgCompCount + refCount + missCount;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 89,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
        overflow: "auto",
        backgroundColor: "rgba(0,0,0,0.6)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading && !applying) {
          onClose();
        }
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 820,
          marginTop: 28,
          maxHeight: "min(92vh, 920px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "18px 20px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: "0 0 8px",
            fontSize: 17,
            fontWeight: 600,
            color: text,
          }}
        >
          Refine practice model — {practice.name.trim() || "Practice"}
        </h3>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            color: mutedColor,
            lineHeight: 1.45,
          }}
        >
          Uses your organisation taxonomy (competency_subjects → competencies) first,
          the shared reference library second, and suggests new org competencies only
          under existing competency_subjects. Practices never create competency_subjects
          here. Shared reference rows are never edited from this flow. Starter Pack
          adoption may already have linked subjects and competencies to this practice —
          use this step to review gaps and fine-tune, not as the only way to connect
          content.
        </p>

        {step === "setup" ? (
          <>
            {error ? (
              <p style={{ fontSize: 13, color: errorColor, marginBottom: 10 }}>
                {error}
              </p>
            ) : null}
            <div
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${borderSubtle}`,
                backgroundColor: bg,
                fontSize: 13,
                color: text,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Practice</div>
              <div style={{ color: mutedColor, marginBottom: 8 }}>
                <strong style={{ color: text }}>Name:</strong>{" "}
                {practice.name.trim()}
              </div>
              <div style={{ color: mutedColor, marginBottom: 8 }}>
                <strong style={{ color: text }}>Description:</strong>{" "}
                {practice.description?.trim() || "—"}
              </div>
              <label
                style={{
                  display: "grid",
                  gap: 6,
                  fontSize: 12,
                  color: mutedColor,
                }}
              >
                Reference framework (optional)
                <input
                  value={referenceFrameworkDraft}
                  onChange={(e) => setReferenceFrameworkDraft(e.target.value)}
                  disabled={!canAuthorHierarchy || loading}
                  placeholder="e.g. BABOK, ITIL — guides AI alignment"
                  style={{
                    padding: "8px 10px",
                    fontSize: 14,
                    color: text,
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                  }}
                />
              </label>
              <p style={{ margin: "8px 0 0", fontSize: 12, color: mutedColor }}>
                Saved on the practice when you run the review.
              </p>
            </div>
            {loading && loadingStage ? (
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: 13,
                  color: text,
                  fontWeight: 500,
                }}
              >
                {STAGE_LABEL[loadingStage]}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={loading || !canAuthorHierarchy || !assignableSubjects.length}
                onClick={() => void runReview()}
                style={btnPrimary}
              >
                {loading ? "Running…" : "Run AI review"}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={onClose}
                style={btn}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {error ? (
              <p style={{ fontSize: 13, color: errorColor, marginBottom: 10 }}>
                {error}
              </p>
            ) : null}
            {result && totalSuggestions === 0 ? (
              <p
                style={{
                  fontSize: 14,
                  color: mutedColor,
                  lineHeight: 1.5,
                  marginBottom: 12,
                }}
              >
                We couldn’t identify strong matches from your organisation taxonomy or
                the shared reference library. Try expanding the practice description or
                adding a reference framework.
              </p>
            ) : null}
            {result && totalSuggestions > 0 ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${borderSubtle}`,
                  fontSize: 13,
                  color: text,
                }}
              >
                <strong>Summary</strong>
                <span style={{ color: mutedColor, marginLeft: 8 }}>
                  Organisation: {orgSubjectCount} competency_subject(s) suggested,{" "}
                  {orgCompCount} competency(ies) · Reference library: {refCount} ·
                  Suggested new: {missCount}
                </span>
              </div>
            ) : null}

            {applySummary ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${borderSubtle}`,
                  backgroundColor: bg,
                  fontSize: 13,
                  color: text,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Apply result</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: mutedColor }}>
                  {applySummary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result &&
            (result.notes.coverage_gaps.length > 0 ||
              result.notes.framework_alignment.length > 0) ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${borderSubtle}`,
                  fontSize: 12,
                  color: mutedColor,
                }}
              >
                {result.notes.framework_alignment.length > 0 ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, color: text, marginBottom: 4 }}>
                      Framework alignment
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {result.notes.framework_alignment.map((x, i) => (
                        <li key={`fa-${i}`}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {result.notes.coverage_gaps.length > 0 ? (
                  <div>
                    <div style={{ fontWeight: 600, color: text, marginBottom: 4 }}>
                      Coverage gaps
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {result.notes.coverage_gaps.map((x, i) => (
                        <li key={`cg-${i}`}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div
              style={{
                overflow: "auto",
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <section>
                <h4
                  style={{
                    margin: "0 0 8px",
                    fontSize: 14,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  A. Already in your organisation
                </h4>
                <p style={{ fontSize: 12, color: mutedColor, margin: "0 0 8px" }}>
                  Link competency_subjects and competencies to this practice. Items
                  already linked (including from Starter Pack adoption) are shown and
                  checkboxes are disabled.
                </p>

                {result && result.relevant_subjects.length === 0 ? (
                  <p style={{ fontSize: 13, color: mutedColor, margin: 0 }}>
                    No competency_subject suggestions.
                  </p>
                ) : null}
                {result?.relevant_subjects.map((row, i) => {
                  const linked = subjectIsRelevantToPractice(
                    subjectPracticeLinks,
                    row.subject_id,
                    practice.id,
                    subjects.find((s) => s.id === row.subject_id) ?? null,
                  );
                  return (
                    <div
                      key={`${row.subject_id}-${i}`}
                      style={{
                        padding: "10px 0",
                        borderTop: `1px solid ${borderSubtle}`,
                        fontSize: 13,
                        color: text,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          cursor: linked ? "default" : "pointer",
                          opacity: linked ? 0.75 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={subjectLinkChecked[i] ?? false}
                          disabled={
                            !canAuthorHierarchy ||
                            applying ||
                            linked
                          }
                          onChange={(e) => {
                            const v = e.target.checked;
                            setSubjectLinkChecked((prev) => {
                              const n = [...prev];
                              n[i] = v;
                              return n;
                            });
                          }}
                          style={{ marginTop: 3 }}
                        />
                        <span style={{ flex: 1 }}>
                          <span style={badgeStyle("org")}>Organisation</span>
                          <strong style={{ marginLeft: 8 }}>
                            {row.subject_name}
                          </strong>
                          {linked ? (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 12,
                                color: mutedColor,
                              }}
                            >
                              Already linked to practice
                            </span>
                          ) : null}
                          <div
                            style={{
                              fontSize: 12,
                              color: mutedColor,
                              marginTop: 4,
                            }}
                          >
                            {row.reason}
                          </div>
                        </span>
                      </label>
                    </div>
                  );
                })}

                {result && result.relevant_competencies.length === 0 ? (
                  <p
                    style={{
                      fontSize: 13,
                      color: mutedColor,
                      margin: "8px 0 0",
                    }}
                  >
                    No organisation competency suggestions.
                  </p>
                ) : null}
                {result?.relevant_competencies.map((row, i) => {
                  const linked = competencyLinkedToPractice(
                    competencyPracticeLinks,
                    row.competency_id,
                    practice.id,
                  );
                  return (
                    <div
                      key={`${row.competency_id}-${i}`}
                      style={{
                        padding: "10px 0",
                        borderTop: `1px solid ${borderSubtle}`,
                        fontSize: 13,
                        color: text,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          cursor: linked ? "default" : "pointer",
                          opacity: linked ? 0.75 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={competencyLinkChecked[i] ?? false}
                          disabled={
                            !canAuthorHierarchy ||
                            applying ||
                            linked
                          }
                          onChange={(e) => {
                            const v = e.target.checked;
                            setCompetencyLinkChecked((prev) => {
                              const n = [...prev];
                              n[i] = v;
                              return n;
                            });
                          }}
                          style={{ marginTop: 3 }}
                        />
                        <span style={{ flex: 1 }}>
                          <span style={badgeStyle("org")}>Organisation</span>
                          <strong style={{ marginLeft: 8 }}>
                            {row.competency_name}
                          </strong>
                          {linked ? (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 12,
                                color: mutedColor,
                              }}
                            >
                              Already linked to practice
                            </span>
                          ) : null}
                          <div
                            style={{
                              fontSize: 12,
                              color: mutedColor,
                            }}
                          >
                            Competency subject: {row.subject_name}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: mutedColor,
                              marginTop: 4,
                            }}
                          >
                            {row.reason}
                          </div>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </section>

              <section>
                <h4
                  style={{
                    margin: "0 0 8px",
                    fontSize: 14,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  B. Available from reference library
                </h4>
                <p style={{ fontSize: 12, color: mutedColor, margin: "0 0 8px" }}>
                  <strong>Adopt + link</strong> adds this shared competency to your
                  organisation (under the correct adopted competency_subject) and links
                  it to the practice. Parent reference subjects are adopted automatically
                  when needed.
                </p>
                {result && result.reference_competencies.length === 0 ? (
                  <p style={{ fontSize: 13, color: mutedColor, margin: 0 }}>
                    No reference competency suggestions.
                  </p>
                ) : null}
                {result?.reference_competencies.map((row, i) => (
                  <label
                    key={`${row.reference_competency_id}-${i}`}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "10px 0",
                      borderTop: `1px solid ${borderSubtle}`,
                      fontSize: 13,
                      color: text,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={referenceAdoptChecked[i] ?? false}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setReferenceAdoptChecked((prev) => {
                          const n = [...prev];
                          n[i] = v;
                          return n;
                        });
                      }}
                      disabled={!canAuthorHierarchy || applying}
                      style={{ marginTop: 3 }}
                    />
                    <span style={{ flex: 1 }}>
                      <span style={badgeStyle("ref")}>Reference</span>
                      <strong style={{ marginLeft: 8 }}>
                        {row.reference_competency_name}
                      </strong>
                      <div style={{ fontSize: 12, color: mutedColor }}>
                        Reference subject: {row.reference_subject_name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: mutedColor,
                          marginTop: 4,
                        }}
                      >
                        {row.reason}
                      </div>
                    </span>
                  </label>
                ))}
              </section>

              <section>
                <h4
                  style={{
                    margin: "0 0 8px",
                    fontSize: 14,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  C. Suggested new organisation competencies
                </h4>
                <p style={{ fontSize: 12, color: mutedColor, margin: "0 0 8px" }}>
                  <strong>Create + link</strong> creates a new organisation competency
                  and links it. <strong>Create only</strong> adds the competency without
                  a practice link. You must choose an existing competency_subject — this
                  flow never creates competency_subjects.
                </p>
                {result && result.missing_competencies.length === 0 ? (
                  <p style={{ fontSize: 13, color: mutedColor, margin: 0 }}>
                    No new-name suggestions.
                  </p>
                ) : null}
                {result?.missing_competencies.map((row, i) => {
                  const chosenSubject = missingSubjectChoice[i] ?? row.subject_id;
                  const dup = findExactCompetencyOnSubject(
                    row.name,
                    chosenSubject,
                    competencies,
                  );
                  return (
                    <div
                      key={`${row.name}-${i}`}
                      style={{
                        padding: "10px 0",
                        borderTop: `1px solid ${borderSubtle}`,
                        fontSize: 13,
                        color: text,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={missingInclude[i] ?? false}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setMissingInclude((prev) => {
                              const n = [...prev];
                              n[i] = v;
                              return n;
                            });
                          }}
                          disabled={!canAuthorHierarchy || applying}
                          style={{ marginTop: 3 }}
                        />
                        <span style={{ flex: 1 }}>
                          <span style={badgeStyle("sug")}>Suggested</span>
                          <strong style={{ marginLeft: 8 }}>{row.name}</strong>
                          <div
                            style={{
                              fontSize: 12,
                              color: mutedColor,
                              marginTop: 4,
                            }}
                          >
                            {row.reason}
                          </div>
                        </span>
                      </label>
                      <label
                        style={{
                          display: "grid",
                          gap: 4,
                          marginTop: 8,
                          marginLeft: 28,
                          fontSize: 12,
                          color: mutedColor,
                        }}
                      >
                        Parent organisation competency_subject
                        <select
                          value={chosenSubject}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMissingSubjectChoice((prev) => {
                              const n = [...prev];
                              n[i] = v;
                              return n;
                            });
                          }}
                          disabled={!canAuthorHierarchy || applying}
                          style={{
                            padding: "8px 10px",
                            fontSize: 14,
                            borderRadius: 8,
                            border: `1px solid ${border}`,
                            backgroundColor: bg,
                            color: text,
                          }}
                        >
                          {assignableSubjects.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name.trim()}
                            </option>
                          ))}
                        </select>
                      </label>
                      {dup ? (
                        <p
                          style={{
                            margin: "8px 0 0 28px",
                            fontSize: 12,
                            color: errorColor,
                          }}
                        >
                          A competency with this name already exists on this subject (
                          {dup.name}). Applying will reuse or link it instead of
                          creating a duplicate.
                        </p>
                      ) : null}
                      <select
                        value={missingAction[i] ?? "create_and_link"}
                        onChange={(e) => {
                          const v = e.target.value as MissingRowAction;
                          setMissingAction((prev) => {
                            const n = [...prev];
                            n[i] = v;
                            return n;
                          });
                        }}
                        disabled={
                          !canAuthorHierarchy ||
                          applying ||
                          !(missingInclude[i] ?? false)
                        }
                        style={{
                          marginTop: 8,
                          marginLeft: 28,
                          padding: "6px 8px",
                          fontSize: 13,
                          borderRadius: 8,
                          border: `1px solid ${border}`,
                          backgroundColor: bg,
                          color: text,
                        }}
                      >
                        <option value="create_and_link">Create + link to practice</option>
                        <option value="create_only">Create only</option>
                      </select>
                    </div>
                  );
                })}
              </section>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <button
                type="button"
                disabled={applying || !canAuthorHierarchy || !result}
                onClick={() => void handleApply()}
                style={btnPrimary}
              >
                {applying ? "Applying…" : "Apply"}
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={() => {
                  setStep("setup");
                  setResult(null);
                  setApplySummary(null);
                }}
                style={btnSecondary}
              >
                Back
              </button>
              <button type="button" disabled={applying} onClick={onClose} style={btn}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

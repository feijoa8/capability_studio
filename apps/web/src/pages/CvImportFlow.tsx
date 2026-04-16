import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { applyCvImport } from "./hub/cvImportApply";
import { requestCvExtract } from "./hub/cvImportApi";
import {
  annotateProjectsSelectable,
  annotateSelectable,
  parseCvPayload,
  type CvEvidenceImportMode,
  type CvExtractedPayload,
  type CvProjectDraft,
  type Selectable,
  type CvWorkExperienceDraft,
  type CvQualificationDraft,
  type CvCertificationDraft,
} from "./hub/cvImportLogic";
import type {
  UserCertificationRow,
  UserExperienceProject,
  UserExperienceRow,
  UserQualificationRow,
} from "./hub/types";
import {
  accentMuted,
  bg,
  border,
  borderSubtle,
  btn,
  btnPrimary,
  errorColor,
  mutedColor,
  surface,
  surfaceHover,
  text,
} from "./hub/hubTheme";
import type { StoredCvRow } from "./CurrentCvReference";

type Props = {
  /** Required for workspace import; null when using `importMode="personal"`. */
  activeOrgId: string | null;
  /** `personal` = `import-cv-extract` without org; `workspace` = membership + org id. */
  importMode: "workspace" | "personal";
  userId: string | null;
  experiences: UserExperienceRow[];
  qualifications: UserQualificationRow[];
  certifications: UserCertificationRow[];
  projects: UserExperienceProject[];
  onReload: () => Promise<void>;
  /** Increment (e.g. from “Replace CV”) to open the import panel with “Store CV” enabled. */
  openImportRequest?: number;
  /** When set, user can run extraction from the already-stored CV without re-uploading. */
  storedCv?: StoredCvRow | null;
};

type Step = "idle" | "uploading" | "preview" | "saving";

const EVIDENCE_MODE_OPTIONS: {
  value: CvEvidenceImportMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "merge",
    label: "Merge",
    hint: "Safest default: skip roles and projects that already match what you have.",
  },
  {
    value: "append",
    label: "Append",
    hint: "Add alongside existing evidence. New roles are added even if the title and company match; exact duplicate projects under the same role are still skipped.",
  },
  {
    value: "replace",
    label: "Replace",
    hint: "Removes all saved work roles for your account and their projects, then imports your selection. Qualifications and certifications stay as they are.",
  },
];

export function CvImportFlow({
  activeOrgId,
  importMode,
  userId,
  experiences,
  qualifications,
  certifications,
  projects,
  onReload,
  openImportRequest = 0,
  storedCv: storedCvRow = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [storeCv, setStoreCv] = useState(false);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  /** User chose “Use current CV” as the extract source (vs a newly selected file). */
  const [useStoredCv, setUseStoredCv] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** True when the current preview came from “Use current CV” (no new storage upload). */
  const [extractedFromStoredCv, setExtractedFromStoredCv] = useState(false);
  const [meta, setMeta] = useState<{
    text_length: number;
    truncated: boolean;
    stored_cv: { id: string; storage_path: string } | null;
    replaced_personal_cv_count?: number;
  } | null>(null);

  const projectDraftsRef = useRef<CvProjectDraft[]>([]);
  const [work, setWork] = useState<Selectable<CvWorkExperienceDraft>[]>([]);
  const [proj, setProj] = useState<Selectable<CvProjectDraft>[]>([]);
  const [quals, setQuals] = useState<Selectable<CvQualificationDraft>[]>([]);
  const [certs, setCerts] = useState<Selectable<CvCertificationDraft>[]>([]);
  const [finishingStoreOnly, setFinishingStoreOnly] = useState(false);
  const [evidenceImportMode, setEvidenceImportMode] =
    useState<CvEvidenceImportMode>("merge");
  const lastPayloadRef = useRef<CvExtractedPayload | null>(null);
  const importContextRef = useRef({
    experiences,
    qualifications,
    certifications,
    projects,
  });
  importContextRef.current = {
    experiences,
    qualifications,
    certifications,
    projects,
  };
  const evidenceImportModeRef = useRef(evidenceImportMode);
  evidenceImportModeRef.current = evidenceImportMode;

  useEffect(() => {
    if (step !== "preview" || !lastPayloadRef.current) return;
    const payload = lastPayloadRef.current;
    const { experiences: ex, qualifications: qu, certifications: ce, projects: pr } =
      importContextRef.current;
    const expForAnnot =
      evidenceImportMode === "replace" ? [] : ex;
    const projForAnnot =
      evidenceImportMode === "replace" ? [] : pr;
    const ann = annotateSelectable(
      payload,
      expForAnnot,
      qu,
      ce,
      projForAnnot,
      { importMode: evidenceImportMode }
    );
    projectDraftsRef.current = payload.projects;
    setWork(ann.work_experience);
    setQuals(ann.qualifications);
    setCerts(ann.certifications);
  }, [evidenceImportMode, step]);

  useEffect(() => {
    if (step !== "preview" || projectDraftsRef.current.length === 0) return;
    setProj((prev) => {
      const next = annotateProjectsSelectable(
        projectDraftsRef.current.map((p) => ({ ...p, include: true })),
        work,
        evidenceImportMode === "replace" ? [] : experiences,
        evidenceImportMode === "replace" ? [] : projects,
        { importMode: evidenceImportMode }
      );
      if (prev.length !== next.length) return next;
      return next.map((row, i) => {
        if (!row.include && row.duplicateNote) return row;
        return { ...row, include: prev[i]?.include ?? row.include };
      });
    });
  }, [work, experiences, projects, evidenceImportMode, step]);

  async function runExtractPipeline(file: File, effectiveStoreCv: boolean) {
    setError(null);
    if (!userId) {
      setError("Not signed in.");
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      setError("Only PDF or DOCX files are supported.");
      return;
    }

    setStep("uploading");
    try {
      const orgForWorkspace = activeOrgId?.trim() ?? "";
      if (importMode === "workspace" && !orgForWorkspace) {
        setError("Choose a workspace to import a CV into this organisation context.");
        setExtractedFromStoredCv(false);
        setStep("idle");
        return;
      }
      const { extracted, meta: m } =
        importMode === "personal"
          ? await requestCvExtract(file, effectiveStoreCv, {
              kind: "personal_profile",
            })
          : await requestCvExtract(file, effectiveStoreCv, {
              kind: "workspace",
              organisationId: orgForWorkspace,
            });
      const payload = parseCvPayload(extracted);
      lastPayloadRef.current = payload;
      const modeNow = evidenceImportModeRef.current;
      const { experiences: ex, qualifications: qu, certifications: ce, projects: pr } =
        importContextRef.current;
      const expForAnnot = modeNow === "replace" ? [] : ex;
      const projForAnnot = modeNow === "replace" ? [] : pr;
      const ann = annotateSelectable(
        payload,
        expForAnnot,
        qu,
        ce,
        projForAnnot,
        { importMode: modeNow }
      );
      projectDraftsRef.current = payload.projects;
      setWork(ann.work_experience);
      setProj(ann.projects);
      setQuals(ann.qualifications);
      setCerts(ann.certifications);
      setMeta({
        text_length: m.text_length,
        truncated: m.truncated,
        stored_cv: m.stored_cv,
        replaced_personal_cv_count: m.replaced_personal_cv_count,
      });
      setFileLabel(file.name);
      setStep("preview");
    } catch (err) {
      setExtractedFromStoredCv(false);
      setError(err instanceof Error ? err.message : "Import failed.");
      setStep("idle");
    }
  }

  function chooseStoredCvAsSource() {
    if (step === "uploading" || !storedCvRow) return;
    setError(null);
    setUseStoredCv(true);
    setFileLabel(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onExtract() {
    setError(null);
    if (!userId) {
      setError("Not signed in.");
      return;
    }
    if (useStoredCv) {
      if (!storedCvRow) {
        setError("No stored CV available.");
        return;
      }
      setExtractedFromStoredCv(true);
      const { data: blob, error: dlErr } = await supabase.storage
        .from("cv-uploads")
        .download(storedCvRow.storage_path);
      if (dlErr || !blob) {
        setError(
          dlErr?.message ??
            "Could not load your stored CV. Try uploading again."
        );
        setExtractedFromStoredCv(false);
        return;
      }
      const name = storedCvRow.original_filename?.trim() || "cv.pdf";
      const mime =
        storedCvRow.mime_type?.trim() ||
        (name.toLowerCase().endsWith(".docx")
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf");
      const file = new File([blob], name, { type: mime });
      await runExtractPipeline(file, false);
      return;
    }
    setExtractedFromStoredCv(false);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF or DOCX file.");
      return;
    }
    await runExtractPipeline(file, storeCv);
  }

  async function onApply() {
    if (!userId) return;
    if (evidenceImportMode === "replace") {
      const ok = window.confirm(
        "Replace removes every saved work role for your account (and all projects under those roles), then adds what you have checked below. Qualifications and certifications are not deleted. This cannot be undone. Continue?"
      );
      if (!ok) return;
    }
    setError(null);
    setStep("saving");
    try {
      const result = await applyCvImport({
        activeOrgId:
          importMode === "personal" ? null : activeOrgId?.trim() ?? null,
        userId,
        experiences,
        existingQualifications: qualifications,
        existingCertifications: certifications,
        existingProjects: projects,
        work_experience: work,
        projects: proj,
        qualifications: quals,
        certifications: certs,
        importMode: evidenceImportMode,
      });
      await onReload();
      setStep("idle");
      setOpen(false);
      projectDraftsRef.current = [];
      lastPayloadRef.current = null;
      setWork([]);
      setProj([]);
      setQuals([]);
      setCerts([]);
      setMeta(null);
      const s = result.skipped;
      const msg = [
        `Imported: ${result.counts.experience} roles, ${result.counts.projects} projects, ${result.counts.qualifications} qualifications, ${result.counts.certifications} certifications.`,
        s.length ? `Skipped (${s.length}): ${s.slice(0, 5).join("; ")}${s.length > 5 ? "…" : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      alert(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save import.");
      setStep("preview");
    }
  }

  async function onFinishStoreOnly() {
    setFinishingStoreOnly(true);
    try {
      await onReload();
      resetFlow();
      setStep("idle");
      setOpen(false);
    } finally {
      setFinishingStoreOnly(false);
    }
  }

  function startOverFromPreview() {
    resetFlow();
    setStep("idle");
  }

  function resetFlow() {
    setStep("idle");
    setError(null);
    projectDraftsRef.current = [];
    lastPayloadRef.current = null;
    setEvidenceImportMode("merge");
    setWork([]);
    setProj([]);
    setQuals([]);
    setCerts([]);
    setMeta(null);
    setFileLabel(null);
    setUseStoredCv(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setExtractedFromStoredCv(false);
  }

  useEffect(() => {
    if (openImportRequest === 0) return;
    setStoreCv(true);
    setOpen(true);
    resetFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to external open signal
  }, [openImportRequest]);

  const card = {
    padding: "14px 16px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "flex" as const,
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: mutedColor,
    cursor: "pointer",
  };

  const totalSelected =
    work.filter((w) => w.include).length +
    proj.filter((p) => p.include).length +
    quals.filter((q) => q.include).length +
    certs.filter((c) => c.include).length;

  const countIncluded = <T extends { include: boolean }>(rows: T[]) =>
    rows.filter((r) => r.include).length;

  const totalExtractedRows =
    work.length + proj.length + quals.length + certs.length;

  const hasNothingToImport = totalSelected === 0;
  const storeOnlySuccess =
    hasNothingToImport &&
    storeCv &&
    Boolean(meta?.stored_cv);
  const storeWantedButMissing =
    hasNothingToImport &&
    storeCv &&
    !meta?.stored_cv;

  /** True when every extracted row is flagged as a duplicate (nothing new to import). */
  const allRowsAreDuplicates =
    totalExtractedRows > 0 &&
    [...work, ...proj, ...quals, ...certs].every((r) => r.duplicateNote);

  const hasFileSelected =
    (fileInputRef.current?.files?.length ?? 0) > 0;
  const extractSourceReady =
    Boolean(useStoredCv && storedCvRow) ||
    Boolean(!useStoredCv && hasFileSelected);
  const canStartExtract =
    Boolean(userId) && extractSourceReady && step !== "uploading";

  return (
    <section style={card}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: mutedColor,
            }}
          >
            Import from CV
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
            Choose a source file, pick how new evidence should combine with what
            you already have, then extract. You review everything before it is
            saved to My Experience.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (
              open &&
              step === "preview" &&
              !confirm("Discard this import preview?")
            ) {
              return;
            }
            if (open) {
              resetFlow();
              setStep("idle");
            }
            setOpen((o) => !o);
          }}
          style={{ ...btn, fontSize: 13 }}
        >
          {open ? "Close" : "Import from CV"}
        </button>
      </div>

      {open ? (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 18 }}>
          {error ? (
            <p style={{ margin: 0, fontSize: 13, color: errorColor }}>{error}</p>
          ) : null}

          {step === "idle" || step === "uploading" ? (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 18 }}
            >
              <GuidedStep
                number={1}
                title="Source"
                description="Use your saved CV or upload a new PDF or DOCX."
              >
                {storedCvRow ? (
                  <>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        disabled={step === "uploading"}
                        onClick={chooseStoredCvAsSource}
                        style={{
                          ...btn,
                          fontSize: 13,
                          alignSelf: "flex-start",
                        }}
                      >
                        Use current CV
                      </button>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: mutedColor,
                          lineHeight: 1.45,
                        }}
                      >
                        Runs extraction on your saved file (
                        {storedCvRow.original_filename}) without uploading again.
                      </p>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        margin: "14px 0",
                      }}
                      aria-hidden
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 1,
                          backgroundColor: borderSubtle,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: mutedColor,
                        }}
                      >
                        or
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 1,
                          backgroundColor: borderSubtle,
                        }}
                      />
                    </div>
                  </>
                ) : null}
                <div>
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 12,
                      fontWeight: 600,
                      color: text,
                    }}
                  >
                    {storedCvRow ? "Upload a different file" : "Upload a file"}
                  </p>
                  <input
                    ref={fileInputRef}
                    name="cvfile"
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    disabled={step === "uploading"}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setUseStoredCv(false);
                        setFileLabel(f.name);
                      } else {
                        setFileLabel(null);
                      }
                    }}
                    style={{ fontSize: 13, color: text }}
                  />
                  {fileLabel && !useStoredCv ? (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 12,
                        color: mutedColor,
                      }}
                    >
                      Selected: {fileLabel}
                    </p>
                  ) : null}
                  {useStoredCv && storedCvRow ? (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 12,
                        color: mutedColor,
                      }}
                    >
                      Source: current saved CV (
                      {storedCvRow.original_filename})
                    </p>
                  ) : null}
                </div>
              </GuidedStep>

              <GuidedStep
                number={2}
                title="Import mode"
                description="Controls how roles and projects line up with what is already saved."
              >
                <div
                  role="radiogroup"
                  aria-label="Import mode"
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  {EVIDENCE_MODE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        cursor: "pointer",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `1px solid ${
                          evidenceImportMode === opt.value ? border : borderSubtle
                        }`,
                        backgroundColor:
                          evidenceImportMode === opt.value ? surfaceHover : bg,
                      }}
                    >
                      <input
                        type="radio"
                        name="evidenceImportMode"
                        checked={evidenceImportMode === opt.value}
                        onChange={() => setEvidenceImportMode(opt.value)}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 13,
                            fontWeight: 600,
                            color: text,
                          }}
                        >
                          {opt.label}
                          {opt.value === "replace" ? (
                            <span style={{ fontWeight: 500, color: errorColor }}>
                              {" "}
                              — removes existing roles and projects
                            </span>
                          ) : null}
                        </span>
                        <span
                          style={{
                            display: "block",
                            marginTop: 4,
                            fontSize: 12,
                            color: mutedColor,
                            lineHeight: 1.45,
                          }}
                        >
                          {opt.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </GuidedStep>

              <GuidedStep
                number={3}
                title="Optional storage"
                description="Keep a reference copy in My Experience (separate from importing rows)."
              >
                <label style={labelStyle}>
                  <input
                    type="checkbox"
                    checked={storeCv}
                    onChange={(e) => setStoreCv(e.target.checked)}
                  />
                  Save a copy of this file (CV reference)
                </label>
              </GuidedStep>

              <GuidedStep
                number={4}
                title="Extract"
                description="Send the file for text extraction. You will confirm what to import on the next screen."
              >
                <button
                  type="button"
                  disabled={!canStartExtract}
                  onClick={() => void onExtract()}
                  style={{
                    ...btnPrimary,
                    fontSize: 13,
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  {step === "uploading" && extractedFromStoredCv
                    ? "Extracting…"
                    : step === "uploading"
                      ? "Uploading & extracting…"
                      : "Extract and review"}
                </button>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                    textAlign: "center",
                  }}
                >
                  You will review and confirm before anything is saved.
                </p>
              </GuidedStep>
            </div>
          ) : null}

          {step === "preview" || step === "saving" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 22,
                marginTop: 4,
              }}
            >
              {meta ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    backgroundColor: accentMuted,
                    border: `1px solid rgba(110, 176, 240, 0.22)`,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 12, color: mutedColor, lineHeight: 1.5 }}>
                    <strong style={{ color: text }}>Source text:</strong>{" "}
                    ~{meta.text_length.toLocaleString()} characters
                    {meta.truncated ? " (truncated for processing)" : ""}.
                  </p>
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: 12,
                      color: mutedColor,
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: text }}>CV file:</strong>{" "}
                    {extractedFromStoredCv
                      ? "Using your stored Current CV (no new file upload)."
                      : meta.stored_cv
                        ? meta.replaced_personal_cv_count && meta.replaced_personal_cv_count > 0
                          ? `Saved (replaced ${meta.replaced_personal_cv_count} previous personal CV reference${meta.replaced_personal_cv_count === 1 ? "" : "s"}).`
                          : "A copy was saved when you uploaded (reference only)."
                        : "Not saved. Opt in above on your next upload to keep a copy."}
                  </p>
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: 12,
                      color: mutedColor,
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: text }}>Import mode:</strong>{" "}
                    {EVIDENCE_MODE_OPTIONS.find((o) => o.value === evidenceImportMode)
                      ?.label ?? evidenceImportMode}
                    . Checked items below are added to My Experience (separate from
                    saving the file).
                  </p>
                </div>
              ) : null}

              {evidenceImportMode === "replace" ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    backgroundColor: "rgba(220, 90, 70, 0.08)",
                    border: "1px solid rgba(220, 90, 70, 0.35)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: text,
                    }}
                  >
                    Replace mode
                  </p>
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 12,
                      color: mutedColor,
                      lineHeight: 1.55,
                    }}
                  >
                    When you import, all current work roles for your account and
                    their projects are removed first, then only what you keep
                    checked here is added back. Qualifications and certifications
                    are not removed. There is no CV-only provenance field yet:
                    this clears <strong style={{ color: text }}>every</strong>{" "}
                    role and project row for your user, not only items from past
                    CV imports.
                  </p>
                </div>
              ) : null}

              {storeOnlySuccess ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    backgroundColor: accentMuted,
                    border: `1px solid rgba(110, 176, 240, 0.28)`,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: text,
                    }}
                  >
                    No new experience items to import
                  </p>
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 13,
                      color: mutedColor,
                      lineHeight: 1.55,
                    }}
                  >
                    {totalExtractedRows === 0
                      ? "Nothing new was extracted to add. You can still use your saved CV as a reference."
                      : allRowsAreDuplicates
                        ? "Everything we extracted matches what you already have. You can still use your saved CV as a reference."
                        : "No items are selected to add, or nothing new is available. Your CV file was still saved for future reference."}
                  </p>
                </div>
              ) : null}

              {storeWantedButMissing ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    backgroundColor: bg,
                    border: `1px solid ${borderSubtle}`,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: mutedColor,
                      lineHeight: 1.55,
                    }}
                  >
                    <strong style={{ color: text }}>Storage did not complete.</strong>{" "}
                    No new items were found to import, and we could not confirm
                    your file was saved. Use{" "}
                    <strong style={{ color: text }}>Start over</strong> and try
                    uploading again with “Save a copy…” checked.
                  </p>
                </div>
              ) : null}

              {!storeOnlySuccess &&
              !storeWantedButMissing &&
              hasNothingToImport &&
              !storeCv ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: mutedColor,
                    lineHeight: 1.55,
                  }}
                >
                  No new experience items were found to add.{" "}
                  <strong style={{ color: text }}>Start over</strong> to try
                  another file, or opt in to save a copy of the file on your
                  next upload.
                </p>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 10,
                }}
              >
                <PreviewStat label="Roles" total={work.length} selected={countIncluded(work)} />
                <PreviewStat label="Projects" total={proj.length} selected={countIncluded(proj)} />
                <PreviewStat
                  label="Qualifications"
                  total={quals.length}
                  selected={countIncluded(quals)}
                />
                <PreviewStat
                  label="Certifications"
                  total={certs.length}
                  selected={countIncluded(certs)}
                />
              </div>

              <PreviewBlock
                title="Work experience"
                empty="No roles extracted."
                total={work.length}
                selected={countIncluded(work)}
                rows={work}
                renderRow={(w, i) => (
                  <label
                    key={i}
                    style={previewRowStyle(w.include)}
                  >
                    <input
                      type="checkbox"
                      checked={w.include}
                      onChange={() =>
                        setWork((prev) =>
                          prev.map((row, j) =>
                            j === i ? { ...row, include: !row.include } : row
                          )
                        )
                      }
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 600, color: text, lineHeight: 1.45 }}>
                        {w.role_title}
                      </span>
                      <span style={{ color: mutedColor }}> — </span>
                      <span style={{ color: text, lineHeight: 1.45, wordBreak: "break-word" }}>
                        {w.organisation_name}
                      </span>
                      {w.duplicateNote ? (
                        <span style={{ color: errorColor, fontSize: 12 }}>
                          {" "}
                          ({w.duplicateNote})
                        </span>
                      ) : null}
                      <div style={{ marginTop: 6, fontSize: 12, color: mutedColor }}>
                        {w.start_date ?? "?"} –{" "}
                        {w.is_current ? "Present" : w.end_date ?? "?"}
                      </div>
                      {previewSnippet(w.description) ? (
                        <p
                          style={{
                            margin: "10px 0 0",
                            fontSize: 12,
                            color: mutedColor,
                            lineHeight: 1.55,
                            wordBreak: "break-word",
                          }}
                        >
                          {previewSnippet(w.description)}
                        </p>
                      ) : null}
                      {w.skills.length +
                        w.methods.length +
                        w.tools.length >
                      0 ? (
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 11,
                            color: mutedColor,
                            lineHeight: 1.5,
                          }}
                        >
                          Evidence tags: {w.skills.length} skills ·{" "}
                          {w.methods.length} methods · {w.tools.length} tools
                          {w.industry?.trim()
                            ? ` · industry: ${w.industry.trim()}`
                            : ""}
                        </p>
                      ) : null}
                    </span>
                  </label>
                )}
              />

              <PreviewBlock
                title="Projects"
                empty="No projects extracted (or none matched a role)."
                total={proj.length}
                selected={countIncluded(proj)}
                rows={proj}
                renderRow={(p, i) => (
                  <label
                    key={i}
                    style={previewRowStyle(p.include)}
                  >
                    <input
                      type="checkbox"
                      checked={p.include}
                      onChange={() =>
                        setProj((prev) =>
                          prev.map((row, j) =>
                            j === i ? { ...row, include: !row.include } : row
                          )
                        )
                      }
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 600, color: text, wordBreak: "break-word" }}>
                        {p.project_name}
                      </span>
                      {p.duplicateNote ? (
                        <span style={{ color: errorColor, fontSize: 12 }}>
                          {" "}
                          ({p.duplicateNote})
                        </span>
                      ) : null}
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color: mutedColor,
                          lineHeight: 1.5,
                          wordBreak: "break-word",
                        }}
                      >
                        Hints: {p.parent_role_title_hint ?? "—"} @{" "}
                        {p.parent_organisation_hint ?? "—"}
                      </div>
                      {previewSnippet(p.description) ? (
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 12,
                            color: mutedColor,
                            lineHeight: 1.55,
                            wordBreak: "break-word",
                          }}
                        >
                          {previewSnippet(p.description)}
                        </p>
                      ) : null}
                      {p.skills.length +
                        p.methods.length +
                        p.tools.length >
                      0 ? (
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 11,
                            color: mutedColor,
                            lineHeight: 1.5,
                          }}
                        >
                          Evidence tags: {p.skills.length} skills ·{" "}
                          {p.methods.length} methods · {p.tools.length} tools
                          {p.industry?.trim()
                            ? ` · industry: ${p.industry.trim()}`
                            : ""}
                        </p>
                      ) : null}
                    </span>
                  </label>
                )}
              />

              <PreviewBlock
                title="Qualifications"
                empty="No qualifications extracted."
                total={quals.length}
                selected={countIncluded(quals)}
                rows={quals}
                renderRow={(q, i) => (
                  <label
                    key={i}
                    style={previewRowStyle(q.include)}
                  >
                    <input
                      type="checkbox"
                      checked={q.include}
                      onChange={() =>
                        setQuals((prev) =>
                          prev.map((row, j) =>
                            j === i ? { ...row, include: !row.include } : row
                          )
                        )
                      }
                    />
                    <span style={{ minWidth: 0, flex: 1, lineHeight: 1.55, wordBreak: "break-word" }}>
                      <span style={{ fontWeight: 600, color: text }}>{q.title}</span>
                      {q.issuer ? (
                        <span style={{ color: mutedColor }}> — {q.issuer}</span>
                      ) : null}
                      {q.duplicateNote ? (
                        <span style={{ color: errorColor, fontSize: 12 }}>
                          {" "}
                          ({q.duplicateNote})
                        </span>
                      ) : null}
                    </span>
                  </label>
                )}
              />

              <PreviewBlock
                title="Certifications"
                empty="No certifications extracted."
                total={certs.length}
                selected={countIncluded(certs)}
                rows={certs}
                renderRow={(c, i) => (
                  <label
                    key={i}
                    style={previewRowStyle(c.include)}
                  >
                    <input
                      type="checkbox"
                      checked={c.include}
                      onChange={() =>
                        setCerts((prev) =>
                          prev.map((row, j) =>
                            j === i ? { ...row, include: !row.include } : row
                          )
                        )
                      }
                    />
                    <span style={{ minWidth: 0, flex: 1, lineHeight: 1.55, wordBreak: "break-word" }}>
                      <span style={{ fontWeight: 600, color: text }}>{c.title}</span>
                      {c.issuer ? (
                        <span style={{ color: mutedColor }}> — {c.issuer}</span>
                      ) : null}
                      {c.duplicateNote ? (
                        <span style={{ color: errorColor, fontSize: 12 }}>
                          {" "}
                          ({c.duplicateNote})
                        </span>
                      ) : null}
                    </span>
                  </label>
                )}
              />

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                {storeOnlySuccess ? (
                  <>
                    <button
                      type="button"
                      disabled={finishingStoreOnly || step === "saving"}
                      onClick={() => void onFinishStoreOnly()}
                      style={{ ...btnPrimary, fontSize: 13 }}
                    >
                      {finishingStoreOnly ? "Finishing…" : "Done"}
                    </button>
                    <button
                      type="button"
                      disabled={finishingStoreOnly || step === "saving"}
                      onClick={startOverFromPreview}
                      style={{ ...btn, fontSize: 13 }}
                    >
                      Start over
                    </button>
                  </>
                ) : storeWantedButMissing || (hasNothingToImport && !storeCv) ? (
                  <button
                    type="button"
                    disabled={step === "saving" || finishingStoreOnly}
                    onClick={startOverFromPreview}
                    style={{ ...btn, fontSize: 13 }}
                  >
                    Start over
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={step === "saving" || totalSelected === 0}
                      onClick={() => void onApply()}
                      style={{ ...btnPrimary, fontSize: 13 }}
                    >
                      {step === "saving"
                        ? "Saving…"
                        : `Import to My Experience (${totalSelected})`}
                    </button>
                    <button
                      type="button"
                      disabled={step === "saving" || finishingStoreOnly}
                      onClick={startOverFromPreview}
                      style={{ ...btn, fontSize: 13 }}
                    >
                      Start over
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GuidedStep({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${borderSubtle}`,
        backgroundColor: bg,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <span
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            borderRadius: "50%",
            backgroundColor: surfaceHover,
            border: `1px solid ${border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            color: text,
          }}
        >
          {number}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 650, color: text }}>
            {title}
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: mutedColor,
              lineHeight: 1.45,
            }}
          >
            {description}
          </p>
          <div style={{ marginTop: 12 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_SNIPPET_MAX = 220;

function previewSnippet(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const t = text.trim();
  return t.length <= PREVIEW_SNIPPET_MAX
    ? t
    : `${t.slice(0, PREVIEW_SNIPPET_MAX - 1)}…`;
}

function previewRowStyle(include: boolean): CSSProperties {
  return {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    fontSize: 13,
    color: text,
    opacity: include ? 1 : 0.55,
    padding: "12px 14px",
    borderRadius: 8,
    backgroundColor: include ? surfaceHover : bg,
    border: `1px solid ${borderSubtle}`,
    cursor: "pointer",
  };
}

function PreviewStat({
  label,
  total,
  selected,
}: {
  label: string;
  total: number;
  selected: number;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        backgroundColor: bg,
        border: `1px solid ${border}`,
      }}
    >
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: mutedColor, textTransform: "uppercase" }}>
        {label}
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 15, fontWeight: 600, color: text }}>
        {total}
        <span style={{ fontWeight: 500, fontSize: 13, color: mutedColor }}>
          {" "}
          · {selected} selected
        </span>
      </p>
    </div>
  );
}

function PreviewBlock<T>({
  title,
  empty,
  total,
  selected,
  rows,
  renderRow,
}: {
  title: string;
  empty: string;
  total: number;
  selected: number;
  rows: T[];
  renderRow: (row: T, index: number) => ReactNode;
}) {
  return (
    <div
      style={{
        paddingTop: 4,
        borderTop: `1px solid ${borderSubtle}`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 650,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: text,
          }}
        >
          {title}
        </p>
        {total > 0 ? (
          <span style={{ fontSize: 12, color: mutedColor }}>
            {total} {total === 1 ? "item" : "items"} · {selected} selected
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>{empty}</p>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {rows.map((row, i) => renderRow(row, i))}
        </div>
      )}
    </div>
  );
}

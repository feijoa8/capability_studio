import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "../lib/supabase";
import { applyCvImport } from "./hub/cvImportApply";
import { requestCvExtract } from "./hub/cvImportApi";
import {
  annotateProjectsSelectable,
  annotateSelectable,
  parseCvPayload,
  type CvProfileDraft,
  type Selectable,
  type CvWorkExperienceDraft,
  type CvProjectDraft,
} from "./hub/cvImportLogic";
import type { UserExperienceProject, UserExperienceRow } from "./hub/types";
import {
  accentMuted,
  bg,
  border,
  btn,
  btnPrimary,
  errorColor,
  mutedColor,
  text,
} from "./hub/hubTheme";

/** CV → profile mapping (V1): first/last name, summary, location, LinkedIn; experience → user_experience / projects. */
const SUCCESS_SURFACE = "rgba(196, 245, 66, 0.1)";
const SUCCESS_BORDER = "rgba(196, 245, 66, 0.28)";
const WARN_SURFACE = "rgba(232, 120, 72, 0.12)";
const WARN_BORDER = "rgba(232, 120, 72, 0.35)";

type Step = "idle" | "uploading" | "review" | "saving" | "success";

type ApplyResult = {
  profileLabels: string[];
  rolesAdded: number;
  projectsAdded: number;
  skipped: string[];
  cvStored: boolean;
};

type Props = {
  userId: string;
  current: {
    firstName: string;
    lastName: string;
    summary: string;
    location: string;
    linkedinUrl: string;
  };
  onApplied: () => void;
};

function isBlank(s: string): boolean {
  return !s.trim();
}

export function ProfileCvPrefillSection({
  userId,
  current,
  onApplied,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [extractionHint, setExtractionHint] = useState<string | null>(null);
  const [storeCv, setStoreCv] = useState(true);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    text_length: number;
    truncated: boolean;
    stored_cv: { id: string; storage_path: string } | null;
    replaced_personal_cv_count?: number;
  } | null>(null);

  const [experiences, setExperiences] = useState<UserExperienceRow[]>([]);
  const [projectRows, setProjectRows] = useState<UserExperienceProject[]>([]);

  const [profileDraft, setProfileDraft] = useState<CvProfileDraft | null>(
    null,
  );
  const [incFirst, setIncFirst] = useState(false);
  const [incLast, setIncLast] = useState(false);
  const [incSummary, setIncSummary] = useState(false);
  const [incLocation, setIncLocation] = useState(false);
  const [incLinkedin, setIncLinkedin] = useState(false);

  const [work, setWork] = useState<Selectable<CvWorkExperienceDraft>[]>([]);
  const [proj, setProj] = useState<Selectable<CvProjectDraft>[]>([]);
  const projectDraftsRef = useRef<CvProjectDraft[]>([]);

  const loadExperience = useCallback(async () => {
    const exRes = await supabase
      .from("user_experience")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true });
    if (exRes.error) {
      console.warn(exRes.error.message);
      setExperiences([]);
    } else {
      setExperiences((exRes.data as UserExperienceRow[]) ?? []);
    }
    const prRes = await supabase
      .from("user_experience_projects")
      .select("*")
      .eq("user_id", userId);
    if (prRes.error) {
      console.warn(prRes.error.message);
      setProjectRows([]);
    } else {
      setProjectRows((prRes.data as UserExperienceProject[]) ?? []);
    }
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    void loadExperience();
  }, [open, loadExperience]);

  useEffect(() => {
    if (projectDraftsRef.current.length === 0) return;
    setProj((prev) => {
      const next = annotateProjectsSelectable(
        projectDraftsRef.current.map((p) => ({ ...p, include: true })),
        work,
        experiences,
        projectRows,
      );
      return next.map((row, i) => {
        if (!row.include && row.duplicateNote) return row;
        return { ...row, include: prev[i]?.include ?? row.include };
      });
    });
  }, [work, experiences, projectRows]);

  function resetReview() {
    setStep("idle");
    setError(null);
    setApplyResult(null);
    setExtractionHint(null);
    setMeta(null);
    setFileLabel(null);
    setProfileDraft(null);
    projectDraftsRef.current = [];
    setWork([]);
    setProj([]);
  }

  function finishSuccess() {
    resetReview();
    setOpen(false);
  }

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const input = (e.target as HTMLFormElement).elements.namedItem(
      "cvfile",
    ) as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      setError("Choose a PDF or DOCX file.");
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
      setError("Only PDF or DOCX files are supported.");
      return;
    }

    setStep("uploading");
    setExtractionHint(null);
    try {
      const exRes = await supabase
        .from("user_experience")
        .select("*")
        .eq("user_id", userId)
        .order("sort_order", { ascending: true });
      const prRes = await supabase
        .from("user_experience_projects")
        .select("*")
        .eq("user_id", userId);
      const exRows = (exRes.data as UserExperienceRow[]) ?? [];
      const prRows = (prRes.data as UserExperienceProject[]) ?? [];
      if (exRes.error) console.warn(exRes.error.message);
      if (prRes.error) console.warn(prRes.error.message);
      setExperiences(exRows);
      setProjectRows(prRows);

      const { extracted, meta: m } = await requestCvExtract(file, storeCv, {
        kind: "personal_profile",
      });
      const payload = parseCvPayload(extracted);
      const slim = {
        ...payload,
        qualifications: [],
        certifications: [],
      };
      const ann = annotateSelectable(slim, exRows, [], [], prRows);
      projectDraftsRef.current = slim.projects;
      setProfileDraft(payload.profile);
      const p = payload.profile;
      setIncFirst(isBlank(current.firstName) && Boolean(p?.first_name?.trim()));
      setIncLast(isBlank(current.lastName) && Boolean(p?.last_name?.trim()));
      setIncSummary(isBlank(current.summary) && Boolean(p?.summary?.trim()));
      setIncLocation(isBlank(current.location) && Boolean(p?.location?.trim()));
      setIncLinkedin(
        isBlank(current.linkedinUrl) && Boolean(p?.linkedin_url?.trim()),
      );
      setWork(ann.work_experience);
      setProj(ann.projects);
      setMeta({
        text_length: m.text_length,
        truncated: m.truncated,
        stored_cv: m.stored_cv,
        replaced_personal_cv_count: m.replaced_personal_cv_count,
      });

      const hasProfile =
        Boolean(p?.first_name?.trim()) ||
        Boolean(p?.last_name?.trim()) ||
        Boolean(p?.summary?.trim()) ||
        Boolean(p?.location?.trim()) ||
        Boolean(p?.linkedin_url?.trim());
      const hasExperience =
        ann.work_experience.length > 0 || ann.projects.length > 0;
      const hints: string[] = [];
      if (m.truncated) {
        hints.push(
          "Part of the document was trimmed for processing. If something is missing, try a shorter file or fewer pages.",
        );
      }
      if (!hasProfile && !hasExperience) {
        hints.push(
          "We could not extract structured profile or experience rows from this file. Try a text-based PDF or DOCX, or a different export.",
        );
      } else if (!hasProfile && hasExperience) {
        hints.push(
          "No profile headline block was detected; you can still add work history below.",
        );
      } else if (hasProfile && !hasExperience) {
        hints.push(
          "No work roles were detected; you can still apply profile fields below.",
        );
      }
      setExtractionHint(hints.length ? hints.join(" ") : null);

      setStep("review");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Import failed.";
      const friendly =
        raw.includes("Very little text") || raw.includes("EXTRACTION_FAILED")
          ? "We could not read enough text from that file. Try a text-based PDF, a DOCX export, or another file."
          : raw.includes("401") || raw.toLowerCase().includes("unauthorized")
            ? "Your session may have expired. Sign in again and retry."
            : raw;
      setError(friendly);
      setStep("idle");
    }
  }

  async function onApply() {
    setError(null);
    setStep("saving");
    try {
      const profileUpdates: Record<string, string | null> = {};
      const profileLabels: string[] = [];

      // Checkbox = user consent. Empty fields default to checked; filled fields default unchecked (no silent overwrite).
      if (profileDraft) {
        if (incFirst && profileDraft.first_name?.trim()) {
          profileUpdates.first_name = profileDraft.first_name.trim();
          profileLabels.push("First name");
        }
        if (incLast && profileDraft.last_name?.trim()) {
          profileUpdates.last_name = profileDraft.last_name.trim();
          profileLabels.push("Last name");
        }
        if (incSummary && profileDraft.summary?.trim()) {
          profileUpdates.summary = profileDraft.summary.trim();
          profileLabels.push("Summary");
        }
        if (incLocation && profileDraft.location?.trim()) {
          profileUpdates.location = profileDraft.location.trim();
          profileLabels.push("Location");
        }
        if (incLinkedin && profileDraft.linkedin_url?.trim()) {
          profileUpdates.linkedin_url = profileDraft.linkedin_url.trim();
          profileLabels.push("LinkedIn");
        }
        if (profileUpdates.first_name || profileUpdates.last_name) {
          profileUpdates.display_name = null;
        }
      }

      if (Object.keys(profileUpdates).length > 0) {
        const { error: upErr } = await supabase
          .from("profiles")
          .update(profileUpdates)
          .eq("id", userId);
        if (upErr) throw upErr;
      }

      const expResult = await applyCvImport({
        activeOrgId: null,
        userId,
        experiences,
        existingQualifications: [],
        existingCertifications: [],
        existingProjects: projectRows,
        work_experience: work,
        projects: proj,
        qualifications: [],
        certifications: [],
      });

      const cvStored = Boolean(meta?.stored_cv);

      setApplyResult({
        profileLabels,
        rolesAdded: expResult.counts.experience,
        projectsAdded: expResult.counts.projects,
        skipped: expResult.skipped,
        cvStored,
      });

      projectDraftsRef.current = [];
      setWork([]);
      setProj([]);
      setProfileDraft(null);
      setMeta(null);
      setExtractionHint(null);
      setStep("success");
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply import.");
      setStep("review");
    }
  }

  const card = {
    padding: "14px 16px",
    borderRadius: 10,
    backgroundColor: bg,
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

  const hasProfileSuggestion = Boolean(
    profileDraft &&
      (profileDraft.first_name ||
        profileDraft.last_name ||
        profileDraft.summary ||
        profileDraft.location ||
        profileDraft.linkedin_url),
  );

  const workSelected = work.filter((w) => w.include).length;
  const projSelected = proj.filter((p) => p.include).length;
  const profilePickCount =
    (incFirst ? 1 : 0) +
    (incLast ? 1 : 0) +
    (incSummary ? 1 : 0) +
    (incLocation ? 1 : 0) +
    (incLinkedin ? 1 : 0);

  const nothingToApply =
    profilePickCount === 0 && workSelected === 0 && projSelected === 0;

  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
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
            Add from CV
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor, maxWidth: 520, lineHeight: 1.5 }}>
            Upload a PDF or DOCX. We only update your profile when you check each field;
            empty fields can be filled automatically. Experience rows match My Experience
            and skip obvious duplicates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (open && step === "success") {
              finishSuccess();
              return;
            }
            if (open && (step === "review" || step === "saving")) {
              if (!confirm("Discard this import preview?")) return;
            }
            if (open) resetReview();
            setOpen((o) => !o);
          }}
          style={{ ...btn, fontSize: 13 }}
        >
          {open ? "Close" : "Add from CV"}
        </button>
      </div>

      {open ? (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {error && step !== "success" ? (
            <p style={{ margin: 0, fontSize: 13, color: errorColor }}>{error}</p>
          ) : null}

          {step === "success" && applyResult ? (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                backgroundColor: SUCCESS_SURFACE,
                border: `1px solid ${SUCCESS_BORDER}`,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  color: text,
                }}
              >
                {applyResult.profileLabels.length > 0
                  ? "Profile updated from CV"
                  : applyResult.rolesAdded > 0 || applyResult.projectsAdded > 0
                    ? "Experience updated from CV"
                    : "Import finished"}
              </p>
              <ul
                style={{
                  margin: "12px 0 0",
                  paddingLeft: 18,
                  fontSize: 13,
                  color: mutedColor,
                  lineHeight: 1.55,
                }}
              >
                {applyResult.profileLabels.length > 0 ? (
                  <li>
                    <span style={{ color: text }}>Profile: </span>
                    {applyResult.profileLabels.join(", ")}
                  </li>
                ) : null}
                <li>
                  <span style={{ color: text }}>My Experience: </span>
                  {applyResult.rolesAdded} role(s), {applyResult.projectsAdded}{" "}
                  project(s) added
                </li>
                {applyResult.cvStored ? (
                  <li>
                    <span style={{ color: text }}>CV file: </span>
                    A copy is linked to your account as a reference.
                  </li>
                ) : (
                  <li style={{ fontSize: 12 }}>
                    No file was stored (you can enable “keep a copy” next time).
                  </li>
                )}
                {applyResult.skipped.length > 0 ? (
                  <li>
                    <span style={{ color: text }}>Skipped: </span>
                    {applyResult.skipped.slice(0, 5).join("; ")}
                    {applyResult.skipped.length > 5
                      ? ` (+${applyResult.skipped.length - 5} more)`
                      : ""}
                  </li>
                ) : null}
              </ul>
              {applyResult.profileLabels.length === 0 &&
              applyResult.rolesAdded === 0 &&
              applyResult.projectsAdded === 0 ? (
                <p style={{ margin: "12px 0 0", fontSize: 13, color: mutedColor }}>
                  Nothing new was written — likely everything matched what you already had.
                  Open <strong style={{ color: text }}>My Experience</strong> to confirm.
                </p>
              ) : (
                <p style={{ margin: "12px 0 0", fontSize: 13, color: mutedColor }}>
                  Open <strong style={{ color: text }}>My Experience</strong> to review roles and projects.
                </p>
              )}
              <button
                type="button"
                style={{ ...btnPrimary, fontSize: 13, marginTop: 14 }}
                onClick={() => finishSuccess()}
              >
                Done
              </button>
            </div>
          ) : null}

          {step === "idle" || step === "uploading" ? (
            <form onSubmit={onUpload} style={{ display: "grid", gap: 12 }}>
              <label style={labelStyle}>
                <input
                  type="checkbox"
                  checked={storeCv}
                  onChange={(e) => setStoreCv(e.target.checked)}
                />
                Keep a copy of the file as a reference (stored privately with your account)
              </label>
              <input
                name="cvfile"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) =>
                  setFileLabel(e.target.files?.[0]?.name ?? null)
                }
                style={{ fontSize: 13, color: text }}
              />
              {fileLabel ? (
                <span style={{ fontSize: 12, color: mutedColor }}>
                  Selected: {fileLabel}
                </span>
              ) : null}
              <div>
                <button
                  type="submit"
                  disabled={step === "uploading"}
                  style={{ ...btnPrimary, fontSize: 13 }}
                >
                  {step === "uploading"
                    ? "Uploading and extracting…"
                    : "Upload and extract"}
                </button>
              </div>
            </form>
          ) : null}

          {step === "review" || step === "saving" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {meta ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    backgroundColor: accentMuted,
                    border: "1px solid rgba(110, 176, 240, 0.22)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: mutedColor,
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: text }}>Extraction:</strong> ~
                    {meta.text_length.toLocaleString()} characters read from your file
                    {meta.truncated ? " (truncated for processing)" : ""}.
                    {" "}
                    {meta.stored_cv
                      ? meta.replaced_personal_cv_count && meta.replaced_personal_cv_count > 0
                        ? `Saved (replaced ${meta.replaced_personal_cv_count} previous CV reference${meta.replaced_personal_cv_count === 1 ? "" : "s"}).`
                        : "A copy of the file was saved and linked to your account."
                      : "The file was not kept — enable “keep a copy” if you want a stored reference."}
                  </p>
                </div>
              ) : null}

              {extractionHint ? (
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    backgroundColor: WARN_SURFACE,
                    border: `1px solid ${WARN_BORDER}`,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: text,
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>Note:</strong> {extractionHint}
                  </p>
                </div>
              ) : null}

              <div>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Profile (review checkboxes)
                </p>
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  Only checked fields are saved. Empty profile fields are pre-checked;
                  if you already have text, we leave it unless you opt in to replace it.
                </p>
                {!hasProfileSuggestion ? (
                  <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                    No profile block was detected in this extract. You can still import work
                    experience below.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      fontSize: 13,
                    }}
                  >
                    {profileDraft?.first_name ? (
                      <PrefillRow
                        label="First name"
                        current={current.firstName}
                        proposed={profileDraft.first_name}
                        checked={incFirst}
                        onChange={setIncFirst}
                      />
                    ) : null}
                    {profileDraft?.last_name ? (
                      <PrefillRow
                        label="Last name"
                        current={current.lastName}
                        proposed={profileDraft.last_name}
                        checked={incLast}
                        onChange={setIncLast}
                      />
                    ) : null}
                    {profileDraft?.summary ? (
                      <PrefillRow
                        label="Summary"
                        current={current.summary}
                        proposed={profileDraft.summary}
                        multiline
                        checked={incSummary}
                        onChange={setIncSummary}
                      />
                    ) : null}
                    {profileDraft?.location ? (
                      <PrefillRow
                        label="Location"
                        current={current.location}
                        proposed={profileDraft.location}
                        checked={incLocation}
                        onChange={setIncLocation}
                      />
                    ) : null}
                    {profileDraft?.linkedin_url ? (
                      <PrefillRow
                        label="LinkedIn"
                        current={current.linkedinUrl}
                        proposed={profileDraft.linkedin_url}
                        checked={incLinkedin}
                        onChange={setIncLinkedin}
                      />
                    ) : null}
                  </div>
                )}
              </div>

              <div>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Work experience ({workSelected}/{work.length} selected)
                </p>
                {work.length > 0 ? (
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: 12,
                      color: mutedColor,
                      lineHeight: 1.45,
                    }}
                  >
                    Rows that match your existing roles are unchecked so repeat uploads
                    do not create duplicates.
                  </p>
                ) : null}
                {work.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                    No roles extracted.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {work.map((w, i) => (
                      <li key={i}>
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
                            checked={w.include}
                            onChange={() =>
                              setWork((prev) =>
                                prev.map((row, j) =>
                                  j === i
                                    ? { ...row, include: !row.include }
                                    : row,
                                ),
                              )
                            }
                          />
                          <span style={{ fontSize: 13, color: text }}>
                            <strong>{w.role_title}</strong>
                            <span style={{ color: mutedColor }}> — </span>
                            {w.organisation_name}
                            {w.duplicateNote ? (
                              <span style={{ color: errorColor, fontSize: 12 }}>
                                {" "}
                                ({w.duplicateNote})
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Projects ({projSelected}/{proj.length} selected)
                </p>
                {proj.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                    No projects extracted.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {proj.map((p, i) => (
                      <li key={i}>
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
                            checked={p.include}
                            onChange={() =>
                              setProj((prev) =>
                                prev.map((row, j) =>
                                  j === i
                                    ? { ...row, include: !row.include }
                                    : row,
                                ),
                              )
                            }
                          />
                          <span style={{ fontSize: 13, color: text }}>
                            {p.project_name}
                            {p.duplicateNote ? (
                              <span style={{ color: errorColor, fontSize: 12 }}>
                                {" "}
                                ({p.duplicateNote})
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  type="button"
                  disabled={step === "saving" || nothingToApply}
                  style={{ ...btnPrimary, fontSize: 13 }}
                  onClick={() => void onApply()}
                >
                  {step === "saving" ? "Applying…" : "Apply selected to profile & experience"}
                </button>
                <button
                  type="button"
                  style={{ ...btn, fontSize: 13 }}
                  onClick={() => {
                    resetReview();
                  }}
                >
                  Start over
                </button>
              </div>
              {nothingToApply ? (
                <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
                  Select at least one profile field or experience row to apply.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PrefillRow(props: {
  label: string;
  current: string;
  proposed: string;
  multiline?: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { label, current, proposed, multiline, checked, onChange } = props;
  const hasExisting = !isBlank(current);
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${border}`,
        backgroundColor: bg,
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
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: mutedColor,
            }}
          >
            {label}
          </span>
          {hasExisting ? (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: "#d4b896",
                lineHeight: 1.4,
              }}
            >
              You already have text here — the CV value is not applied unless you
              check this box (replaces your current value).
            </p>
          ) : null}
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: mutedColor,
              lineHeight: 1.45,
            }}
          >
            <span style={{ color: text }}>Current: </span>
            {current.trim() ? (
              <span>{multiline ? current : current}</span>
            ) : (
              <em>empty — CV value can fill this when checked</em>
            )}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: text,
              lineHeight: 1.45,
              whiteSpace: multiline ? "pre-wrap" : "normal",
            }}
          >
            <span style={{ color: mutedColor }}>From CV: </span>
            {proposed}
          </div>
        </span>
      </label>
    </div>
  );
}

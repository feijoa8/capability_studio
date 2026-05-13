import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  border,
  btnGhost,
  btnPrimary,
  errorColor,
  fieldBg,
  mutedColor,
  surface,
} from "../hub/hubTheme";
import {
  coverLetterEditableForCandidateStage,
  submitInternalHiringApplication,
  updateHiringApplicationCoverLetter,
  type HiringApplicationRow,
} from "./hiringApi";
import { requestHiringCoverLetterDraft } from "./hiringCoverLetterDraftApi";

type Props = {
  open: boolean;
  onClose: () => void;
  openingId: string;
  roleTitle: string;
  hasJobProfile: boolean;
  userId: string;
  /** If set, user already has an internal application — cover letter update only. */
  existingApplication: HiringApplicationRow | null;
  onSuccess: () => void;
};

export function InternalHiringApplicationModal({
  open,
  onClose,
  openingId,
  roleTitle,
  hasJobProfile,
  userId,
  existingApplication,
  onSuccess,
}: Props) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(existingApplication);
  const canEditCover =
    !existingApplication ||
    coverLetterEditableForCandidateStage(existingApplication.stage);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setText(
      (existingApplication?.cover_letter_text ?? "").replace(/\r\n/g, "\n"),
    );
  }, [open, existingApplication]);

  if (!open) return null;

  if (!userId) {
    return null;
  }

  async function onGenerateDraft() {
    if (!hasJobProfile) {
      setError("This role has no job profile; a draft cannot be generated.");
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const res = await requestHiringCoverLetterDraft(supabase, openingId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setText(res.draft);
    } finally {
      setGenerating(false);
    }
  }

  async function onPrimary() {
    setError(null);
    if (isEdit) {
      if (!existingApplication || !canEditCover) return;
      setSaving(true);
      try {
        const { error: err } = await updateHiringApplicationCoverLetter(
          supabase,
          existingApplication.id,
          text,
        );
        if (err) {
          setError(err);
          return;
        }
        onSuccess();
        onClose();
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const res = await submitInternalHiringApplication(supabase, {
        openingId,
        userId,
        coverLetterText: text,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = isEdit
    ? "Cover letter / Supporting statement"
    : "Apply to role";

  const primaryLabel = isEdit ? "Save cover letter" : "Submit application";
  const coverReadOnly = isEdit && !canEditCover;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
        padding: 16,
      }}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(90vh, 720px)",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "20px 22px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          {isEdit
            ? `Update your supporting statement for ${roleTitle}.`
            : `Your profile, My Experience, and CV (if you use one) are included with this application. Optionally add a cover letter below — or leave it blank.`}
        </p>
        {isEdit && existingApplication ? (
          <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
            Application stage:{" "}
            <strong style={{ color: text }}>{existingApplication.stage}</strong>
            {coverReadOnly
              ? " — cover letter can no longer be edited at this stage."
              : null}
          </p>
        ) : null}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: mutedColor,
              marginBottom: 8,
            }}
            htmlFor="internal-hiring-cover-letter"
          >
            Cover letter / Supporting statement (optional)
          </label>
          <textarea
            id="internal-hiring-cover-letter"
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={coverReadOnly}
            rows={12}
            placeholder="Write or paste a cover letter, or leave blank…"
            style={{
              width: "100%",
              minHeight: 200,
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
              fontSize: 14,
              lineHeight: 1.5,
              boxSizing: "border-box",
              resize: "vertical",
              opacity: coverReadOnly ? 0.75 : 1,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            type="button"
            style={btnGhost}
            disabled={generating || saving || coverReadOnly || !hasJobProfile}
            onClick={() => void onGenerateDraft()}
            title={
              !hasJobProfile
                ? "This role needs a job profile to generate a draft."
                : undefined
            }
          >
            {generating ? "Generating…" : "Generate draft cover letter"}
          </button>
          <span style={{ fontSize: 12, color: mutedColor }}>
            Draft fills the box only — it is not saved until you{" "}
            {isEdit ? "save" : "submit"}.
          </span>
        </div>
        {error ? (
          <p style={{ color: errorColor, fontSize: 13, margin: 0 }}>{error}</p>
        ) : null}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 4,
          }}
        >
          <button type="button" style={btnGhost} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {!coverReadOnly ? (
            <button
              type="button"
              style={btnPrimary}
              disabled={saving || generating}
              onClick={() => void onPrimary()}
            >
              {saving ? "…" : primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

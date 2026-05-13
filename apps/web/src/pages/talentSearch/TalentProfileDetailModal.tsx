import { useCallback, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  hiringApplicationHasViewableExternalCv,
  openHiringApplicationCv,
  type HiringApplicationRow,
} from "../hiring/hiringApi";
import type { TalentProfileDetailPayload } from "./talentSearchApi";
import { buildTalentProfileDisplayModel } from "./talentProfileDisplayModel";
import {
  accent,
  border,
  errorColor,
  mutedColor,
  panelShell,
  text,
} from "../hub/hubTheme";

type Props = {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  data: TalentProfileDetailPayload | null;
};

function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s && !e) return null;
  const endLabel =
    !e ||
    e.toLowerCase() === "present" ||
    e.toLowerCase() === "current" ||
    e.toLowerCase() === "now"
      ? "Present"
      : e;
  if (s && endLabel) return `${s} – ${endLabel}`;
  return s || endLabel;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function TalentProfileDetailModal({
  open,
  onClose,
  loading,
  error,
  data,
}: Props) {
  const [cvBusy, setCvBusy] = useState(false);
  const [cvErr, setCvErr] = useState<string | null>(null);

  const model = useMemo(
    () => (data ? buildTalentProfileDisplayModel(data) : null),
    [data],
  );

  const p = data?.profile;

  const canViewCv =
    p?.source_type === "external" &&
    typeof p.cv_upload_id === "string" &&
    p.cv_upload_id.length > 0 &&
    !!p.candidate_user_id &&
    !!p.application_id &&
    hiringApplicationHasViewableExternalCv({
      id: p.application_id,
      opening_id: "",
      candidate_user_id: p.candidate_user_id,
      stage: "applied",
      notes: null,
      created_at: "",
      updated_at: "",
      candidate_source: "external",
      cv_upload_id: p.cv_upload_id,
    } as HiringApplicationRow);

  const handleViewCv = useCallback(async () => {
    if (!p?.application_id || !p.candidate_user_id) return;
    setCvErr(null);
    setCvBusy(true);
    try {
      const row = {
        id: p.application_id,
        opening_id: "",
        candidate_user_id: p.candidate_user_id,
        stage: "applied" as const,
        notes: null,
        created_at: "",
        updated_at: "",
        candidate_source: "external" as const,
        cv_upload_id: p.cv_upload_id ?? null,
      } as HiringApplicationRow;
      const res = await openHiringApplicationCv(supabase, row);
      if (!res.ok) setCvErr(res.error);
    } finally {
      setCvBusy(false);
    }
  }, [p]);

  if (!open) return null;

  const industryHint =
    model?.primaryExperiences.map((x) => x.industry).find((x) => x && x.trim()) ??
    model?.supplementaryExperiences.map((x) => x.industry).find((x) => x && x.trim()) ??
    null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          ...panelShell,
          maxWidth: 640,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          marginTop: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, color: text }}>
            {loading ? "Loading…" : p?.display_name ?? "Profile"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: mutedColor,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error ? (
          <p style={{ color: "#e88", margin: 0, fontSize: 14 }}>{error}</p>
        ) : null}

        {!loading && !error && p && model ? (
          <>
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
              {p.source_type === "external" ? "External candidate" : "Internal"}
              {p.contact_allowed ? "" : " · Contact limited"}
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px 16px",
                marginBottom: 12,
                fontSize: 13,
                color: mutedColor,
              }}
            >
              {model.yearsExperience != null ? (
                <span>
                  <strong style={{ color: text, fontWeight: 600 }}>Career span:</strong>{" "}
                  ~{model.yearsExperience} yrs (from role dates)
                </span>
              ) : null}
              {p.location ? (
                <span>
                  <strong style={{ color: text, fontWeight: 600 }}>Location:</strong>{" "}
                  {p.location}
                </span>
              ) : null}
              {industryHint ? (
                <span>
                  <strong style={{ color: text, fontWeight: 600 }}>Industry:</strong>{" "}
                  {industryHint}
                </span>
              ) : null}
            </div>

            {model.headlineSummary ? (
              <p style={{ margin: "0 0 14px", fontSize: 14, color: text, lineHeight: 1.55 }}>
                {model.headlineSummary}
              </p>
            ) : (
              <p style={{ margin: "0 0 14px", fontSize: 13, color: mutedColor }}>
                No summary on file.
              </p>
            )}

            {p.linkedin_url ? (
              <p style={{ margin: "0 0 14px", fontSize: 13 }}>
                <a
                  href={p.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: accent, fontWeight: 500 }}
                >
                  LinkedIn profile ↗
                </a>
              </p>
            ) : null}

            {model.skillsHighlight.length > 0 ? (
              <div style={{ margin: "0 0 14px" }}>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Skills &amp; keywords
                </p>
                <p style={{ margin: 0, fontSize: 13, color: text, lineHeight: 1.5 }}>
                  {model.skillsHighlight.join(" · ")}
                </p>
              </div>
            ) : null}

            <h3
              style={{
                margin: "16px 0 8px",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: mutedColor,
              }}
            >
              {p.source_type === "external" && model.hasCvExtractStructure
                ? "Professional background (from CV extract)"
                : "Experience"}
            </h3>
            {model.primaryExperiences.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                No structured experience rows yet.
              </p>
            ) : (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  color: text,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {model.primaryExperiences.map((ex, i) => (
                  <li key={`p-${i}`} style={{ marginBottom: 14 }}>
                    <strong>{ex.role_title ?? "Role"}</strong>
                    {ex.organisation_name ? ` · ${ex.organisation_name}` : ""}
                    {ex.industry ? (
                      <span style={{ color: mutedColor }}> · {ex.industry}</span>
                    ) : null}
                    {formatDateRange(ex.start_date, ex.end_date) ? (
                      <div style={{ color: mutedColor, fontSize: 12, marginTop: 2 }}>
                        {formatDateRange(ex.start_date, ex.end_date)}
                      </div>
                    ) : null}
                    {ex.description ? (
                      <div style={{ color: mutedColor, marginTop: 6 }}>
                        {clip(ex.description, 420)}
                      </div>
                    ) : null}
                    {ex.skills && ex.skills.length > 0 ? (
                      <div style={{ fontSize: 12, color: mutedColor, marginTop: 6 }}>
                        {ex.skills.slice(0, 14).join(" · ")}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {model.supplementaryExperiences.length > 0 ? (
              <>
                <h3
                  style={{
                    margin: "18px 0 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Also on profile (My Experience)
                </h3>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: text,
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {model.supplementaryExperiences.map((ex, i) => (
                    <li key={`s-${i}`} style={{ marginBottom: 12 }}>
                      <strong>{ex.role_title ?? "Role"}</strong>
                      {ex.organisation_name ? ` · ${ex.organisation_name}` : ""}
                      {ex.description ? (
                        <div style={{ color: mutedColor, marginTop: 4 }}>
                          {clip(ex.description, 280)}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {model.projectHighlights.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <h3
                  style={{
                    margin: "0 0 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Project highlights
                </h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: text }}>
                  {model.projectHighlights.map((pj, i) => (
                    <li key={`pj-${i}`} style={{ marginBottom: 8 }}>
                      <strong>{pj.title}</strong>
                      {pj.subtitle ? (
                        <span style={{ color: mutedColor }}> — {pj.subtitle}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {p.source_type === "external" && canViewCv ? (
              <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${border}` }}>
                <p style={{ margin: "0 0 6px", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
                  Submitted CV (same access as Hiring). Opens in a new tab.
                </p>
                <button
                  type="button"
                  disabled={cvBusy}
                  onClick={() => void handleViewCv()}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: cvBusy ? "wait" : "pointer",
                    fontSize: 13,
                    fontWeight: 500,
                    color: mutedColor,
                    textDecoration: "underline",
                    textUnderlineOffset: 2,
                  }}
                >
                  {cvBusy ? "Opening CV…" : "View CV ↗"}
                </button>
                {cvErr ? (
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: errorColor }}>{cvErr}</p>
                ) : null}
              </div>
            ) : p.source_type === "external" && !canViewCv ? (
              <p style={{ marginTop: 14, fontSize: 12, color: mutedColor }}>
                No uploaded CV on file for this application, or the file is not available to your role.
              </p>
            ) : null}

            {p.contact_allowed && p.email ? (
              <p style={{ margin: "18px 0 0", fontSize: 13 }}>
                <a
                  href={`mailto:${encodeURIComponent(p.email)}`}
                  style={{ color: "#8eb8e8", fontWeight: 600 }}
                >
                  Email {p.display_name}
                </a>
              </p>
            ) : !p.contact_allowed ? (
              <p style={{ margin: "18px 0 0", fontSize: 12, color: mutedColor }}>
                Contact is not enabled for this profile (privacy / consent).
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

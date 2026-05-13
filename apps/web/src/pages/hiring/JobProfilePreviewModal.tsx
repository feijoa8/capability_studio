import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  border,
  btnGhost,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import {
  fetchJobProfilePreviewData,
  type JobProfilePreviewData,
} from "./jobProfilePreview";

type Props = {
  open: boolean;
  jobProfileId: string | null;
  onClose: () => void;
};

export function JobProfilePreviewModal({ open, jobProfileId, onClose }: Props) {
  const [data, setData] = useState<JobProfilePreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompetencies, setShowCompetencies] = useState(false);

  useEffect(() => {
    if (!open || !jobProfileId) {
      setData(null);
      setError(null);
      setShowCompetencies(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const d = await fetchJobProfilePreviewData(supabase, jobProfileId, {
        includeCompetencies: showCompetencies,
      });
      if (cancelled) return;
      if (!d) {
        setError("Could not load job profile.");
        setData(null);
      } else {
        setData(d);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, jobProfileId, showCompetencies]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Job profile preview"
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
          maxHeight: "min(85vh, 720px)",
          overflowY: "auto",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "20px 22px",
          boxSizing: "border-box",
        }}
      >
        <h3
          style={{
            margin: "0 0 12px",
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Job profile preview
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: mutedColor }}>
          Hiring-facing signals only (role copy and skills). Competency mappings are optional
          for L&amp;D. Editing is done in Job Profiles.
        </p>

        {!jobProfileId ? (
          <p style={{ color: mutedColor, margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Select a job profile in the form first. Preview is available when a
            job profile is chosen in the list.
          </p>
        ) : loading ? (
          <p style={{ color: mutedColor, margin: 0 }}>Loading…</p>
        ) : error ? (
          <p style={{ color: "#e87878", margin: 0 }}>{error}</p>
        ) : data ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section>
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
                Title
              </p>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: text }}>
                {data.title}
              </p>
            </section>

            <section>
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
                Level
              </p>
              <p style={{ margin: 0, fontSize: 14, color: text }}>
                {data.levelName ?? "—"}
              </p>
            </section>

            <section>
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
                Role purpose / summary
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: data.roleSummary ? text : mutedColor,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                }}
              >
                {data.roleSummary ?? "No summary on file."}
              </p>
            </section>

            <section>
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
                Responsibilities
              </p>
              {data.responsibilities.length === 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                  None listed.
                </p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: text,
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {data.responsibilities.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </section>

            <section>
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
                Requirements
              </p>
              {data.requirements.length === 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                  None listed.
                </p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: text,
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {data.requirements.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </section>

            <section>
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
                Skills
              </p>
              {data.skills.length === 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                  None listed.
                </p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: text,
                    fontSize: 14,
                    lineHeight: 1.45,
                  }}
                >
                  {data.skills.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </section>

            <section
              style={{
                paddingTop: 4,
                borderTop: `1px dashed ${border}`,
              }}
            >
              <button
                type="button"
                style={{
                  ...btnGhost,
                  fontSize: 12,
                  marginBottom: showCompetencies ? 10 : 0,
                }}
                onClick={() => setShowCompetencies((v) => !v)}
              >
                {showCompetencies
                  ? "Hide developmental competencies"
                  : "Show developmental competencies (L&D)"}
              </button>

              {showCompetencies ? (
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
                    Competency mappings
                  </p>
                  {data.competencies.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
                      None mapped.
                    </p>
                  ) : (
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        color: text,
                        fontSize: 14,
                        lineHeight: 1.45,
                      }}
                    >
                      {data.competencies.map((c, i) => (
                        <li key={i}>
                          {c.name}
                          {c.requiredLevel ? (
                            <span style={{ color: mutedColor }}>
                              {" "}
                              (expected: {c.requiredLevel})
                            </span>
                          ) : null}
                          <span style={{ color: mutedColor, fontSize: 12 }}>
                            {" "}
                            · {c.relevance}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
            </section>
          </div>
        ) : null}

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

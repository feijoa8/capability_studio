import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  deleteApplicationEvaluation,
  getApplicationEvaluation,
  insertApplicationEvaluation,
  listApplicationEvaluations,
  parseComparison,
  parseRoleAnalysis,
  requestCompareJobToEvidence,
  requestExtractJobPosting,
  updateApplicationEvaluation,
  type JobPostingSourceResolutionMeta,
} from "./hub/applicationEvaluationsApi";
import type {
  ApplicationEvaluationRow,
  JobEvidenceComparison,
  RoleAnalysisExtraction,
  EvidenceSnapshotV1,
} from "./hub/types";
import {
  accent,
  accentMuted,
  bg,
  border,
  borderSubtle,
  btnGhost,
  btnPrimary,
  errorColor,
  mutedColor,
  surface,
  surfaceHover,
  text,
} from "./hub/hubTheme";

type Props = {
  isActive: boolean;
};

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function headingFromRow(row: ApplicationEvaluationRow): { title: string; company: string } {
  const ra = parseRoleAnalysis(row.role_analysis);
  const title =
    row.title_hint?.trim() || ra?.job_title?.trim() || "Untitled role";
  const company = row.company_hint?.trim() || ra?.company?.trim() || "";
  return { title, company };
}

function ListBullets({ items, color }: { items: string[]; color: string }) {
  if (items.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>—</p>
    );
  }
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: 18,
        fontSize: 13,
        color,
        lineHeight: 1.55,
      }}
    >
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function ApplicationEvaluationsSection({ isActive }: Props) {
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [rows, setRows] = useState<ApplicationEvaluationRow[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [companyHint, setCompanyHint] = useState("");
  const [rawDescription, setRawDescription] = useState("");

  const [roleAnalysis, setRoleAnalysis] = useState<RoleAnalysisExtraction | null>(
    null,
  );
  const [comparison, setComparison] = useState<JobEvidenceComparison | null>(null);
  const [evidenceSnapshot, setEvidenceSnapshot] = useState<EvidenceSnapshotV1 | null>(
    null,
  );

  const [busyExtract, setBusyExtract] = useState(false);
  const [busyCompare, setBusyCompare] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Set after “Analyse posting” so we can show how text was resolved (paste vs URL). */
  const [sourceResolution, setSourceResolution] =
    useState<JobPostingSourceResolutionMeta | null>(null);

  const refreshList = useCallback(async () => {
    setListError(null);
    try {
      const r = await listApplicationEvaluations();
      setRows(r);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load evaluations.");
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    (async () => {
      setListLoading(true);
      try {
        const r = await listApplicationEvaluations();
        if (!cancelled) setRows(r);
      } catch (e) {
        if (!cancelled) {
          setListError(
            e instanceof Error ? e.message : "Could not load evaluations.",
          );
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive]);

  const resetFormToNew = useCallback(() => {
    setEditingId(null);
    setSourceUrl("");
    setTitleHint("");
    setCompanyHint("");
    setRawDescription("");
    setRoleAnalysis(null);
    setComparison(null);
    setEvidenceSnapshot(null);
    setActionError(null);
    setSourceResolution(null);
  }, []);

  const loadRowIntoForm = useCallback((row: ApplicationEvaluationRow) => {
    setEditingId(row.id);
    setSourceUrl(row.source_url ?? "");
    setTitleHint(row.title_hint ?? "");
    setCompanyHint(row.company_hint ?? "");
    setRawDescription(row.raw_description);
    setRoleAnalysis(parseRoleAnalysis(row.role_analysis));
    setComparison(parseComparison(row.comparison_result));
    setEvidenceSnapshot(row.evidence_snapshot ?? null);
    setActionError(null);
    setSourceResolution(null);
  }, []);

  const resolvedHeader = useMemo(() => {
    const ra = roleAnalysis;
    const title =
      titleHint.trim() || ra?.job_title?.trim() || "Application evaluation";
    const company = companyHint.trim() || ra?.company?.trim() || "";
    const statusLabel =
      comparison != null ? "Compared" : roleAnalysis != null ? "Analysed" : "Draft";
    return { title, company, statusLabel };
  }, [titleHint, companyHint, roleAnalysis, comparison]);

  async function handleExtract() {
    setActionError(null);
    const text = rawDescription.trim();
    const url = sourceUrl.trim();
    if (text.length < 40 && !url) {
      setActionError(
        "Paste a job description (40+ characters) or enter a public job posting URL to fetch.",
      );
      return;
    }
    setBusyExtract(true);
    try {
      const result = await requestExtractJobPosting({
        raw_description: text.length >= 40 ? text : null,
        title_hint: titleHint.trim() || null,
        company_hint: companyHint.trim() || null,
        source_url: url || null,
      });
      setRoleAnalysis(result.extraction);
      setSourceResolution(result.source_resolution ?? null);
      if (result.resolved_posting_text) {
        setRawDescription(result.resolved_posting_text);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusyExtract(false);
    }
  }

  async function handleCompare() {
    if (!roleAnalysis) {
      setActionError("Run “Analyse posting” first.");
      return;
    }
    setActionError(null);
    setBusyCompare(true);
    try {
      const { comparison: c, evidence_snapshot } =
        await requestCompareJobToEvidence(roleAnalysis);
      setComparison(c);
      setEvidenceSnapshot(evidence_snapshot);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setBusyCompare(false);
    }
  }

  async function handleSave() {
    const text = rawDescription.trim();
    if (text.length < 40) {
      setActionError(
        "The saved description must be at least 40 characters. Run “Analyse posting” first (from paste or URL) or paste more text.",
      );
      return;
    }
    if (!roleAnalysis) {
      setActionError("Run “Analyse posting” before saving.");
      return;
    }
    setActionError(null);
    setBusySave(true);
    try {
      const status = comparison != null ? "ready" : "draft";
      if (editingId) {
        const updated = await updateApplicationEvaluation(editingId, {
          title_hint: titleHint.trim() || null,
          company_hint: companyHint.trim() || null,
          source_url: sourceUrl.trim() || null,
          raw_description: text,
          role_analysis: roleAnalysis,
          evidence_snapshot: evidenceSnapshot,
          comparison_result: comparison,
          status,
        });
        setEditingId(updated.id);
        await refreshList();
      } else {
        const created = await insertApplicationEvaluation({
          title_hint: titleHint.trim() || null,
          company_hint: companyHint.trim() || null,
          source_url: sourceUrl.trim() || null,
          raw_description: text,
          role_analysis: roleAnalysis,
          evidence_snapshot: evidenceSnapshot,
          comparison_result: comparison,
          status,
        });
        setEditingId(created.id);
        await refreshList();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusySave(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this evaluation?")) return;
    setActionError(null);
    try {
      await deleteApplicationEvaluation(id);
      if (editingId === id) resetFormToNew();
      await refreshList();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  async function handleSelectSaved(id: string) {
    setActionError(null);
    try {
      const row = await getApplicationEvaluation(id);
      if (row) loadRowIntoForm(row);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not open evaluation.");
    }
  }

  const cardShell = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${borderSubtle}`,
    boxSizing: "border-box" as const,
  };

  return (
    <div
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        width: "100%",
        display: "grid",
        gap: 22,
        boxSizing: "border-box",
      }}
    >
      <header>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: text,
            letterSpacing: "-0.02em",
          }}
        >
          Application Evaluations
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.55,
          }}
        >
          Paste a job description <strong style={{ color: text }}>or</strong> paste a
          public posting URL — we&apos;ll pull visible text when needed (external sites
          only). Then analyse the role and compare it to your My Experience evidence.
        </p>
      </header>

      {listError ? (
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{listError}</p>
      ) : null}
      {actionError ? (
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{actionError}</p>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 280px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
        className="app-eval-layout"
      >
        <aside style={{ ...cardShell, position: "sticky", top: 12 }}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              fontWeight: 600,
              color: mutedColor,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Saved
          </p>
          <button
            type="button"
            style={{ ...btnPrimary, width: "100%", marginBottom: 10 }}
            onClick={resetFormToNew}
          >
            New evaluation
          </button>
          {listLoading ? (
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>Loading…</p>
          ) : rows.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
              No saved evaluations yet.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
              {rows.map((r) => {
                const { title, company } = headingFromRow(r);
                const active = editingId === r.id;
                return (
                  <div
                    key={r.id}
                    style={{
                      borderRadius: 8,
                      border: `1px solid ${active ? "rgba(110, 176, 240, 0.45)" : borderSubtle}`,
                      backgroundColor: active ? accentMuted : bg,
                      padding: "10px 12px",
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void handleSelectSaved(r.id)}
                      style={{
                        margin: 0,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          fontWeight: 600,
                          color: text,
                          lineHeight: 1.35,
                        }}
                      >
                        {title}
                      </p>
                      {company ? (
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: mutedColor }}>
                          {company}
                        </p>
                      ) : null}
                      <p style={{ margin: "6px 0 0", fontSize: 11, color: mutedColor }}>
                        {r.status === "ready" ? "Ready" : "Draft"} ·{" "}
                        {formatShortDate(r.updated_at)}
                      </p>
                    </button>
                    <button
                      type="button"
                      style={{
                        ...btnGhost,
                        fontSize: 11,
                        padding: "4px 8px",
                        justifySelf: "start",
                        color: errorColor,
                        borderColor: "rgba(232, 120, 120, 0.35)",
                      }}
                      onClick={() => void handleDelete(r.id)}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <section style={cardShell}>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Evaluation
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "baseline",
                marginBottom: 14,
              }}
            >
              <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: text }}>
                  {resolvedHeader.title}
                </p>
                {resolvedHeader.company ? (
                  <p style={{ margin: "4px 0 0", fontSize: 14, color: mutedColor }}>
                    {resolvedHeader.company}
                  </p>
                ) : null}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: accent,
                  border: `1px solid rgba(110, 176, 240, 0.35)`,
                  borderRadius: 6,
                  padding: "4px 10px",
                }}
              >
                {resolvedHeader.statusLabel}
              </span>
            </div>
            {sourceResolution?.kind === "external_url" &&
            sourceResolution.fetched_url ? (
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.45,
                }}
              >
                Job text was{" "}
                <span style={{ color: text, fontWeight: 600 }}>loaded from the URL</span>
                . You can edit the description below before saving.
              </p>
            ) : null}

            <form
              style={{ display: "grid", gap: 12 }}
              onSubmit={(e: FormEvent) => e.preventDefault()}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
                  Source URL
                  <input
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://… (fetch page when description below is empty or short)"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 14,
                      color: text,
                      backgroundColor: bg,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      boxSizing: "border-box",
                    }}
                  />
                </label>
                <p style={{ margin: 0, fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
                  If you leave the description empty (or under 40 characters), we fetch
                  this page on the server and extract visible text. Jobs hosted on your own
                  platform are not scraped — those will open from in-product listings later.
                </p>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
                  Title hint (optional)
                  <input
                    value={titleHint}
                    onChange={(e) => setTitleHint(e.target.value)}
                    placeholder="If not clear from text"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 14,
                      color: text,
                      backgroundColor: bg,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      boxSizing: "border-box",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
                  Company hint (optional)
                  <input
                    value={companyHint}
                    onChange={(e) => setCompanyHint(e.target.value)}
                    placeholder="If not clear from text"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 14,
                      color: text,
                      backgroundColor: bg,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      boxSizing: "border-box",
                    }}
                  />
                </label>
              </div>
              <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
                Job description (paste — or filled after URL fetch)
                <textarea
                  value={rawDescription}
                  onChange={(e) => setRawDescription(e.target.value)}
                  rows={12}
                  placeholder="Paste the full posting here, or use a URL above and click Analyse posting…"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: 14,
                    color: text,
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    boxSizing: "border-box",
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                  }}
                />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <button
                  type="button"
                  style={btnPrimary}
                  disabled={busyExtract}
                  onClick={() => void handleExtract()}
                >
                  {busyExtract ? "Analysing…" : "Analyse posting"}
                </button>
                <button
                  type="button"
                  style={btnGhost}
                  disabled={busyCompare || !roleAnalysis}
                  onClick={() => void handleCompare()}
                >
                  {busyCompare ? "Comparing…" : "Compare to my evidence"}
                </button>
                <button
                  type="button"
                  style={btnGhost}
                  disabled={busySave || !roleAnalysis}
                  onClick={() => void handleSave()}
                >
                  {busySave ? "Saving…" : editingId ? "Update saved" : "Save evaluation"}
                </button>
              </div>
            </form>
          </section>

          {roleAnalysis ? (
            <section style={{ ...cardShell, backgroundColor: surfaceHover }}>
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: mutedColor,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Job intelligence
              </p>
              {roleAnalysis.location ? (
                <p style={{ margin: "0 0 8px", fontSize: 13, color: mutedColor }}>
                  Location: <span style={{ color: text }}>{roleAnalysis.location}</span>
                  {roleAnalysis.industry_domain ? (
                    <>
                      {" "}
                      · Domain:{" "}
                      <span style={{ color: text }}>{roleAnalysis.industry_domain}</span>
                    </>
                  ) : null}
                </p>
              ) : roleAnalysis.industry_domain ? (
                <p style={{ margin: "0 0 8px", fontSize: 13, color: mutedColor }}>
                  Domain:{" "}
                  <span style={{ color: text }}>{roleAnalysis.industry_domain}</span>
                </p>
              ) : null}
              <p
                style={{
                  margin: "0 0 14px",
                  fontSize: 14,
                  color: text,
                  lineHeight: 1.55,
                }}
              >
                {roleAnalysis.role_summary}
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Key competencies
                  </p>
                  <ListBullets items={roleAnalysis.key_competencies} color={text} />
                </div>
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Skills
                  </p>
                  <ListBullets items={roleAnalysis.skills} color={text} />
                </div>
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Methods / practices
                  </p>
                  <ListBullets items={roleAnalysis.methods_practices} color={text} />
                </div>
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Tools / platforms
                  </p>
                  <ListBullets items={roleAnalysis.tools_platforms} color={text} />
                </div>
              </div>
              {roleAnalysis.key_role_signals.length > 0 ? (
                <div style={{ marginTop: 14 }}>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Role signals
                  </p>
                  <ListBullets items={roleAnalysis.key_role_signals} color={text} />
                </div>
              ) : null}
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: `1px solid ${borderSubtle}`,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Watch-outs
                  </p>
                  <ListBullets items={roleAnalysis.watch_outs} color={text} />
                </div>
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Questions to ask
                  </p>
                  <ListBullets items={roleAnalysis.questions_to_ask} color={text} />
                </div>
              </div>
            </section>
          ) : null}

          {comparison ? (
            <section style={cardShell}>
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: mutedColor,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Match vs your evidence
              </p>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div
                  style={{
                    fontSize: 36,
                    fontWeight: 700,
                    color: accent,
                    lineHeight: 1,
                  }}
                >
                  {comparison.match_score}
                  <span style={{ fontSize: 14, fontWeight: 600, color: mutedColor }}>
                    {" "}
                    / 100
                  </span>
                </div>
                <p
                  style={{
                    margin: 0,
                    flex: "1 1 240px",
                    fontSize: 14,
                    color: text,
                    lineHeight: 1.55,
                  }}
                >
                  {comparison.summary}
                </p>
              </div>
              <p
                style={{
                  margin: "16px 0 8px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: text,
                }}
              >
                Competency read
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: mutedColor,
                  lineHeight: 1.55,
                }}
              >
                {comparison.competency_summary}
              </p>
              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 16,
                }}
              >
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Strengths
                  </p>
                  <ListBullets items={comparison.strengths} color={text} />
                </div>
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Partial coverage
                  </p>
                  <ListBullets items={comparison.partial_coverage} color={text} />
                </div>
                <div>
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: mutedColor,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Gaps
                  </p>
                  <ListBullets items={comparison.gaps} color={text} />
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .app-eval-layout {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

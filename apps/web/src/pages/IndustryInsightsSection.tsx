import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type {
  IndustryInsightCategory,
  IndustryInsightRow,
  IndustryInsightStatus,
} from "./hub/types";
import { isWorkspaceAdminRole } from "./hub/workspaceRoles";
import {
  bg,
  border,
  btn,
  btnGhost,
  btnPrimary,
  errorColor,
  muted,
  mutedColor,
  panelShell,
  text,
} from "./hub/hubTheme";

const CATEGORIES: IndustryInsightCategory[] = [
  "industry",
  "regulatory",
  "legal",
  "technology",
  "market",
];

const STATUSES: IndustryInsightStatus[] = [
  "active",
  "deprecated",
  "archived",
];

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  workspaceRole: string | null;
};

function parseTags(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tagsToString(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "";
  return tags.join(", ");
}

export function IndustryInsightsSection({
  activeOrgId,
  isActive,
  workspaceRole,
}: Props) {
  const canManage = isWorkspaceAdminRole(workspaceRole);

  const [insights, setInsights] = useState<IndustryInsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<IndustryInsightCategory>("industry");
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("");
  const [tagsStr, setTagsStr] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<IndustryInsightStatus>("active");
  const [saving, setSaving] = useState(false);

  const [linkModalFor, setLinkModalFor] = useState<IndustryInsightRow | null>(
    null
  );
  const [linkNote, setLinkNote] = useState("");
  const [linkScore, setLinkScore] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isActive) return;
    setLoading(true);
    setLoadError(null);
    const res = await supabase
      .from("industry_insights")
      .select("*")
      .order("updated_at", { ascending: false });
    if (res.error) {
      console.error(res.error);
      setLoadError(res.error.message);
      setInsights([]);
    } else {
      setInsights((res.data as IndustryInsightRow[] | null) ?? []);
    }
    setLoading(false);
  }, [isActive]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return insights.filter((row) => {
      if (filterCategory && row.category !== filterCategory) return false;
      if (filterStatus && row.status !== filterStatus) return false;
      if (filterIndustry.trim()) {
        const q = filterIndustry.trim().toLowerCase();
        if (!(row.industry ?? "").toLowerCase().includes(q)) return false;
      }
      if (filterRegion.trim()) {
        const q = filterRegion.trim().toLowerCase();
        if (!(row.region ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [
    insights,
    filterCategory,
    filterIndustry,
    filterRegion,
    filterStatus,
  ]);

  function openCreate() {
    setEditingId(null);
    setTitle("");
    setSummary("");
    setCategory("industry");
    setIndustry("");
    setRegion("");
    setTagsStr("");
    setSourceUrl("");
    setStatus("active");
    setShowForm(true);
  }

  function openEdit(row: IndustryInsightRow) {
    setEditingId(row.id);
    setTitle(row.title);
    setSummary(row.summary);
    setCategory(row.category);
    setIndustry(row.industry ?? "");
    setRegion(row.region ?? "");
    setTagsStr(tagsToString(row.tags));
    setSourceUrl(row.source_url ?? "");
    setStatus(row.status);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canManage) return;
    const t = title.trim();
    const s = summary.trim();
    if (!t || !s) {
      alert("Title and summary are required.");
      return;
    }
    setSaving(true);
    const tags = parseTags(tagsStr);
    const now = new Date().toISOString();
    if (editingId) {
      const { error: err } = await supabase
        .from("industry_insights")
        .update({
          title: t,
          summary: s,
          category,
          industry: industry.trim() || null,
          region: region.trim() || null,
          tags,
          source_url: sourceUrl.trim() || null,
          status,
          updated_at: now,
        })
        .eq("id", editingId);
      setSaving(false);
      if (err) {
        alert(err.message || "Could not save.");
        return;
      }
    } else {
      const { error: err } = await supabase.from("industry_insights").insert({
        title: t,
        summary: s,
        category,
        industry: industry.trim() || null,
        region: region.trim() || null,
        tags,
        source_url: sourceUrl.trim() || null,
        status,
        updated_at: now,
      });
      setSaving(false);
      if (err) {
        alert(err.message || "Could not create.");
        return;
      }
    }
    closeForm();
    await load();
  }

  async function submitLink() {
    if (!linkModalFor || !activeOrgId || !canManage) return;
    setLinkSaving(true);
    const scoreRaw = linkScore.trim();
    let relevance_score: number | null = null;
    if (scoreRaw !== "") {
      const n = Number.parseInt(scoreRaw, 10);
      if (Number.isNaN(n)) {
        alert("Relevance score must be a whole number.");
        setLinkSaving(false);
        return;
      }
      relevance_score = n;
    }
    const { error: err } = await supabase
      .from("organisation_insight_links")
      .insert({
        organisation_id: activeOrgId,
        insight_id: linkModalFor.id,
        relevance_note: linkNote.trim() || null,
        relevance_score,
      });
    setLinkSaving(false);
    if (err) {
      if (err.code === "23505" || err.message.includes("unique")) {
        alert("This insight is already linked to the current organisation.");
      } else {
        alert(err.message || "Could not create link.");
      }
      return;
    }
    setLinkModalFor(null);
    setLinkNote("");
    setLinkScore("");
  }

  if (!isActive) {
    return null;
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <header style={{ marginBottom: 20 }}>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          Intelligence library
        </p>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: text,
            letterSpacing: "-0.02em",
          }}
        >
          Industry insights
        </h2>
        <p style={{ ...muted, margin: "10px 0 0", maxWidth: 640 }}>
          Shared regulatory, legal, market, and technology notes. Link entries
          to your workspace from the list below.
        </p>
      </header>

      {!activeOrgId ? (
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to link insights to your organisation.
        </p>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <label style={{ fontSize: 13, color: mutedColor }}>
          Category{" "}
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{
              marginLeft: 6,
              padding: "6px 10px",
              borderRadius: 6,
              border: `1px solid ${border}`,
              backgroundColor: bg,
              color: text,
            }}
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13, color: mutedColor }}>
          Status{" "}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              marginLeft: 6,
              padding: "6px 10px",
              borderRadius: 6,
              border: `1px solid ${border}`,
              backgroundColor: bg,
              color: text,
            }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          placeholder="Filter industry"
          value={filterIndustry}
          onChange={(e) => setFilterIndustry(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: `1px solid ${border}`,
            backgroundColor: bg,
            color: text,
            minWidth: 140,
          }}
        />
        <input
          type="search"
          placeholder="Filter region"
          value={filterRegion}
          onChange={(e) => setFilterRegion(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: `1px solid ${border}`,
            backgroundColor: bg,
            color: text,
            minWidth: 120,
          }}
        />
        {canManage ? (
          <button type="button" onClick={openCreate} style={btnPrimary}>
            New insight
          </button>
        ) : null}
      </div>

      {loadError ? (
        <p style={{ color: errorColor, fontSize: 14 }}>{loadError}</p>
      ) : null}

      {loading ? (
        <p style={{ ...muted, margin: 0 }}>Loading…</p>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {filtered.map((row) => (
            <li
              key={row.id}
              style={{
                ...panelShell,
                margin: 0,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "6px 10px",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 16,
                        color: text,
                      }}
                    >
                      {row.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: 5,
                        border: `1px solid ${border}`,
                        color: mutedColor,
                      }}
                    >
                      {row.category}
                    </span>
                    {row.status !== "active" ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: `1px solid rgba(212, 168, 75, 0.4)`,
                          color: "#d4a84b",
                        }}
                      >
                        {row.status}
                      </span>
                    ) : null}
                  </div>
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontSize: 14,
                      color: mutedColor,
                      lineHeight: 1.55,
                    }}
                  >
                    {row.summary}
                  </p>
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 12,
                      color: mutedColor,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px 14px",
                    }}
                  >
                    {row.industry ? <span>Industry: {row.industry}</span> : null}
                    {row.region ? <span>Region: {row.region}</span> : null}
                  </div>
                  {row.tags && row.tags.length > 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      {row.tags.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: 11,
                            padding: "4px 8px",
                            borderRadius: 4,
                            backgroundColor: "rgba(110, 176, 240, 0.12)",
                            color: "#9ec8f0",
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {row.source_url ? (
                    <a
                      href={row.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: 10,
                        fontSize: 13,
                        color: "#6eb0f0",
                      }}
                    >
                      {row.source_url}
                    </a>
                  ) : null}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  {activeOrgId && canManage ? (
                    <button
                      type="button"
                      style={{ ...btnPrimary, fontSize: 13 }}
                      onClick={() => {
                        setLinkModalFor(row);
                        setLinkNote("");
                        setLinkScore("");
                      }}
                    >
                      Link to organisation
                    </button>
                  ) : null}
                  {canManage ? (
                    <button
                      type="button"
                      style={{ ...btn, fontSize: 13 }}
                      onClick={() => openEdit(row)}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && filtered.length === 0 && !loadError ? (
        <p style={{ ...muted, margin: 0 }}>
          No insights match the current filters.
        </p>
      ) : null}

      {showForm && canManage ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) closeForm();
          }}
        >
          <form
            onSubmit={(e) => void handleSubmit(e)}
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 32,
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              {editingId ? "Edit insight" : "New insight"}
            </h3>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Title
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Summary
              <textarea
                required
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={saving}
                rows={4}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Category
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as IndustryInsightCategory)
                }
                disabled={saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Industry (optional)
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Region (optional)
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Tags (comma-separated)
              <input
                value={tagsStr}
                onChange={(e) => setTagsStr(e.target.value)}
                disabled={saving}
                placeholder="e.g. GDPR, ISO 27001"
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Source URL (optional)
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                disabled={saving}
                type="url"
                placeholder="https://"
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Status
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as IndustryInsightStatus)
                }
                disabled={saving}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                style={btn}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} style={btnPrimary}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {linkModalFor && activeOrgId && canManage ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 75,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !linkSaving) {
              setLinkModalFor(null);
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 440,
              marginTop: 48,
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Link to organisation
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              <strong style={{ color: text }}>{linkModalFor.title}</strong>
            </p>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Relevance note (optional)
              <textarea
                value={linkNote}
                onChange={(e) => setLinkNote(e.target.value)}
                disabled={linkSaving}
                rows={3}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Relevance score (optional, integer)
              <input
                value={linkScore}
                onChange={(e) => setLinkScore(e.target.value)}
                disabled={linkSaving}
                inputMode="numeric"
                placeholder="e.g. 1–5"
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: bg,
                  color: text,
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setLinkModalFor(null)}
                disabled={linkSaving}
                style={btnGhost}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitLink()}
                disabled={linkSaving}
                style={btnPrimary}
              >
                {linkSaving ? "Linking…" : "Link"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

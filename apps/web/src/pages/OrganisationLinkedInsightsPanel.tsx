import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { IndustryInsightRow } from "./hub/types";
import { canAccessWorkspaceManagementNav } from "./hub/workspaceRoles";
import {
  border,
  btnGhost,
  errorColor,
  muted,
  mutedColor,
  surface,
  text,
} from "./hub/hubTheme";

type LinkWithInsight = {
  id: string;
  relevance_note: string | null;
  relevance_score: number | null;
  created_at: string;
  industry_insights: IndustryInsightRow | IndustryInsightRow[] | null;
};

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  workspaceRole: string | null;
  title?: string;
};

function normalizeInsight(
  raw: IndustryInsightRow | IndustryInsightRow[] | null | undefined
): IndustryInsightRow | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  return row && typeof row === "object" && "id" in row ? row : null;
}

export function OrganisationLinkedInsightsPanel({
  activeOrgId,
  isActive,
  workspaceRole,
  title = "Industry insights linked to this organisation",
}: Props) {
  const canManageLinks = canAccessWorkspaceManagementNav(workspaceRole);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LinkWithInsight[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrgId || !isActive) {
      setLoading(false);
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await supabase
      .from("organisation_insight_links")
      .select(
        "id, relevance_note, relevance_score, created_at, industry_insights ( id, title, summary, category, industry, region, tags, source_url, status, created_at, updated_at )"
      )
      .eq("organisation_id", activeOrgId)
      .order("created_at", { ascending: false });

    if (res.error) {
      console.error(res.error);
      setError(res.error.message);
      setRows([]);
    } else {
      setRows((res.data as LinkWithInsight[] | null) ?? []);
    }
    setLoading(false);
  }, [activeOrgId, isActive]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleUnlink(linkId: string) {
    if (!canManageLinks || !activeOrgId) return;
    if (!window.confirm("Remove this insight link from the organisation?")) return;
    setRemovingId(linkId);
    const { error: delErr } = await supabase
      .from("organisation_insight_links")
      .delete()
      .eq("id", linkId)
      .eq("organisation_id", activeOrgId);
    setRemovingId(null);
    if (delErr) {
      alert(delErr.message || "Could not remove link.");
      return;
    }
    await load();
  }

  if (!isActive || !activeOrgId) {
    return null;
  }

  if (loading) {
    return (
      <section style={{ marginTop: 24 }}>
        <p style={{ ...muted, margin: 0 }}>Loading linked insights…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section style={{ marginTop: 24 }}>
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{error}</p>
      </section>
    );
  }

  return (
    <section style={{ marginTop: 24 }}>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: mutedColor,
        }}
      >
        {title}
      </p>
      {rows.length === 0 ? (
        <p style={{ ...muted, margin: 0, fontSize: 14 }}>
          No industry insights linked yet. Use{" "}
          <strong style={{ color: text }}>Industry Insights</strong> in the
          sidebar to browse the library and link items to this workspace.
        </p>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {rows.map((r) => {
            const ins = normalizeInsight(r.industry_insights);
            return (
              <li
                key={r.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  backgroundColor: surface,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: text,
                      }}
                    >
                      {ins?.title ?? "Insight"}
                    </div>
                    {ins?.status && ins.status !== "active" ? (
                      <span
                        style={{
                          display: "inline-block",
                          marginTop: 6,
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
                        {ins.status}
                      </span>
                    ) : null}
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 13,
                        color: mutedColor,
                        lineHeight: 1.5,
                      }}
                    >
                      {ins?.summary ?? ""}
                    </p>
                    {r.relevance_note ? (
                      <p
                        style={{
                          margin: "8px 0 0",
                          fontSize: 12,
                          color: text,
                          lineHeight: 1.45,
                        }}
                      >
                        <span style={{ color: mutedColor }}>Note: </span>
                        {r.relevance_note}
                      </p>
                    ) : null}
                    {r.relevance_score != null ? (
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: 12,
                          color: mutedColor,
                        }}
                      >
                        Relevance score: {r.relevance_score}
                      </p>
                    ) : null}
                    {ins?.source_url ? (
                      <a
                        href={ins.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-block",
                          marginTop: 8,
                          fontSize: 13,
                          color: "#6eb0f0",
                        }}
                      >
                        Source
                      </a>
                    ) : null}
                  </div>
                  {canManageLinks ? (
                    <button
                      type="button"
                      onClick={() => void handleUnlink(r.id)}
                      disabled={removingId === r.id}
                      style={{ ...btnGhost, fontSize: 12, flexShrink: 0 }}
                    >
                      {removingId === r.id ? "…" : "Unlink"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

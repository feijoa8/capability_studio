import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { buildDraftArticlesFromMetadata } from "../../lib/helpDraftGenerator";
import {
  bg,
  border,
  btn,
  btnPrimary,
  errorColor,
  mutedColor,
  panelShell,
  surface,
  text,
} from "../hub/hubTheme";

type Tab = "articles" | "faqs" | "glossary" | "mappings" | "queue";

type Props = { isActive: boolean };

export function HelpCenterAdminSection({ isActive }: Props) {
  const [tab, setTab] = useState<Tab>("articles");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [articles, setArticles] = useState<Record<string, unknown>[]>([]);
  const [faqs, setFaqs] = useState<Record<string, unknown>[]>([]);
  const [terms, setTerms] = useState<Record<string, unknown>[]>([]);
  const [mappings, setMappings] = useState<Record<string, unknown>[]>([]);
  const [queue, setQueue] = useState<Record<string, unknown>[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, f, g, m, q] = await Promise.all([
        supabase
          .from("help_articles")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("help_faqs")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(200),
        supabase
          .from("help_glossary_terms")
          .select("*")
          .order("term", { ascending: true })
          .limit(500),
        supabase
          .from("help_context_mappings")
          .select("*")
          .order("page_key", { ascending: true }),
        supabase
          .from("help_change_queue")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (a.error) throw new Error(a.error.message);
      if (f.error) throw new Error(f.error.message);
      if (g.error) throw new Error(g.error.message);
      if (m.error) throw new Error(m.error.message);
      if (q.error) throw new Error(q.error.message);
      setArticles((a.data ?? []) as Record<string, unknown>[]);
      setFaqs((f.data ?? []) as Record<string, unknown>[]);
      setTerms((g.data ?? []) as Record<string, unknown>[]);
      setMappings((m.data ?? []) as Record<string, unknown>[]);
      setQueue((q.data ?? []) as Record<string, unknown>[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void reload();
  }, [isActive, reload]);

  async function seedDraftMetadata() {
    setError(null);
    try {
      const drafts = buildDraftArticlesFromMetadata();
      for (const d of drafts) {
        const { error: insErr } = await supabase.from("help_articles").upsert(
          {
            slug: d.slug,
            title: d.title,
            summary: d.summary,
            body_markdown: d.body_markdown,
            article_type: d.article_type,
            audience: d.audience,
            related_surface: d.related_surface,
            related_page_key: d.related_page_key,
            status: "draft",
            version: 1,
            generated_from: d.generated_from,
          },
          { onConflict: "slug" },
        );
        if (insErr) throw new Error(insErr.message);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!isActive) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "articles", label: "Articles" },
    { id: "faqs", label: "FAQs" },
    { id: "glossary", label: "Glossary" },
    { id: "mappings", label: "Context" },
    { id: "queue", label: "Change queue" },
  ];

  return (
    <div style={{ ...panelShell, maxWidth: 1100 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, color: text }}>
        Help Center (system)
      </h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor, lineHeight: 1.5 }}>
        Published content feeds the Capability Studio assistant (in-app) and the public website
        help API. Chat answers are grounded in these rows — not the other way around.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${tab === t.id ? text : border}`,
              backgroundColor: tab === t.id ? surface : bg,
              color: text,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
        <button type="button" style={btn} onClick={() => void reload()}>
          Refresh
        </button>
        <button type="button" style={btnPrimary} onClick={() => void seedDraftMetadata()}>
          Upsert draft articles from metadata
        </button>
      </div>
      {error ? <p style={{ color: errorColor }}>{error}</p> : null}
      {loading ? <p style={{ color: mutedColor }}>Loading…</p> : null}

      {!loading && tab === "articles" ? (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ color: mutedColor, textAlign: "left" }}>
                <th style={{ padding: 8 }}>Slug</th>
                <th style={{ padding: 8 }}>Title</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Surface</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((r) => (
                <tr
                  key={String(r.id)}
                  style={{ borderTop: `1px solid ${border}`, color: text }}
                >
                  <td style={{ padding: 8 }}>{String(r.slug ?? "")}</td>
                  <td style={{ padding: 8 }}>{String(r.title ?? "")}</td>
                  <td style={{ padding: 8 }}>{String(r.status ?? "")}</td>
                  <td style={{ padding: 8 }}>{String(r.related_surface ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: mutedColor, marginTop: 12 }}>
            Use Supabase Studio or future inline editor to publish. Upsert adds draft articles
            for major app surfaces.
          </p>
        </div>
      ) : null}

      {!loading && tab === "faqs" ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: text, fontSize: 13 }}>
          {faqs.map((r) => (
            <li key={String(r.id)} style={{ marginBottom: 8 }}>
              <strong>{String(r.question ?? "")}</strong> ({String(r.status ?? "")})
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && tab === "glossary" ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: text, fontSize: 13 }}>
          {terms.map((r) => (
            <li key={String(r.id)} style={{ marginBottom: 8 }}>
              <strong>{String(r.term ?? "")}</strong> — {String(r.status ?? "")}
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && tab === "mappings" ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: text, fontSize: 13 }}>
          {mappings.map((r) => (
            <li key={String(r.id)} style={{ marginBottom: 6 }}>
              {String(r.surface)} / {String(r.page_key)}{" "}
              {r.feature_key ? ` / ${String(r.feature_key)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && tab === "queue" ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: text, fontSize: 13 }}>
          {queue.map((r) => (
            <li key={String(r.id)} style={{ marginBottom: 8 }}>
              {String(r.review_status)} — {String(r.source_key ?? "")}:{" "}
              {String(r.detected_change_summary ?? "").slice(0, 120)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const client = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: req.headers.get("Authorization")
        ? { Authorization: req.headers.get("Authorization")! }
        : {},
    },
  });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "articles";

  try {
    if (req.method === "GET" && action === "articles") {
      const surface = url.searchParams.get("surface") ?? "website";
      const q = client
        .from("help_articles")
        .select(
          "id, slug, title, summary, body_markdown, article_type, audience, related_surface, related_page_key, related_feature_key, status, published_at",
        )
        .eq("status", "published")
        .in("related_surface", [surface, "both"]);
      const { data, error } = await q.order("title");
      if (error) throw error;
      return json({ articles: data ?? [] });
    }

    if (req.method === "GET" && action === "faqs") {
      const surface = url.searchParams.get("surface") ?? "website";
      const { data, error } = await client
        .from("help_faqs")
        .select("id, question, answer, related_surface, related_page_key, published_at")
        .eq("status", "published")
        .in("related_surface", [surface, "both"])
        .order("question");
      if (error) throw error;
      return json({ faqs: data ?? [] });
    }

    if (req.method === "GET" && action === "context") {
      const surface = url.searchParams.get("surface") ?? "website";
      const page_key = url.searchParams.get("page_key") ?? "landing";
      const { data, error } = await client
        .from("help_context_mappings")
        .select("*")
        .in("surface", [surface, "both"])
        .eq("page_key", page_key)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return json({ mapping: data });
    }

    if (req.method === "POST" && action === "chat") {
      const body = (await req.json()) as {
        question?: string;
        context?: {
          surface?: string;
          page_key?: string;
          feature_key?: string | null;
        };
      };
      const question = (body.question ?? "").trim();
      if (!question) {
        return json({ error: "question required" }, 400);
      }
      const surface = (body.context?.surface ?? "website") as
        | "app"
        | "website"
        | "both";
      const page_key = body.context?.page_key ?? "landing";
      const feature_key = body.context?.feature_key ?? null;

      const { data: mapping } = await client
        .from("help_context_mappings")
        .select("*")
        .in("surface", [surface, "both"])
        .eq("page_key", page_key)
        .is("feature_key", feature_key)
        .maybeSingle();

      const articles: unknown[] = [];
      if (mapping?.default_article_ids?.length) {
        const { data: a } = await client
          .from("help_articles")
          .select("id, title, summary, body_markdown")
          .in("id", mapping.default_article_ids)
          .eq("status", "published");
        if (a?.length) articles.push(...a);
      }

      const { data: pageArticles } = await client
        .from("help_articles")
        .select("id, title, summary, body_markdown")
        .eq("status", "published")
        .in("related_surface", [surface, "both"])
        .eq("related_page_key", page_key)
        .limit(6);

      const parts: string[] = [];
      const src = [...articles, ...(pageArticles ?? [])];
      for (const row of src as { title?: string; summary?: string | null; body_markdown?: string | null }[]) {
        const ex = (row.summary ?? row.body_markdown ?? "").slice(0, 400);
        if (ex) parts.push(`### ${row.title}\n${ex}`);
      }
      const reply =
        parts.length > 0
          ? parts.join("\n\n---\n\n")
          : "No published help content matched this page yet. Published website articles for Capability Studio will appear here once your team adds them in the Help Center.";

      return json({
        reply,
        sources: src.slice(0, 8).map((r: { id?: string; title?: string }) => ({
          id: r.id,
          title: r.title,
        })),
      });
    }

    return json({ error: "Unsupported action or method" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

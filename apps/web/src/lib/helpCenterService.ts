/**
 * Help Center: contextual lookup and grounded answers from published content only.
 * Chatbot layer must not invent product behaviour — it composes excerpts from DB rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type HelpSurface = "app" | "website" | "both";

export type HelpContextPayload = {
  surface: HelpSurface;
  page_key?: string | null;
  feature_key?: string | null;
  workspace_role?: string | null;
  /** `workspace_memberships.system_role` (e.g. platform operator row) — used for system_admin help audience. */
  system_role?: string | null;
  /** `profiles.system_role` (e.g. learning_consultant) — distinct from membership row. */
  profile_system_role?: string | null;
  organisation_id?: string | null;
};

export type HelpArticleRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_markdown: string | null;
  article_type: string;
  audience: string;
  related_surface: string;
  related_page_key: string | null;
  related_feature_key: string | null;
  status: string;
};

export type HelpFaqRow = {
  id: string;
  question: string;
  answer: string;
  related_surface: string;
  related_page_key: string | null;
  status: string;
};

export type HelpGlossaryRow = {
  id: string;
  term: string;
  definition: string;
  aliases: string[];
  status: string;
};

export type HelpContextMappingRow = {
  id: string;
  surface: string;
  page_key: string;
  feature_key: string | null;
  default_article_ids: string[];
  default_faq_ids: string[];
  starter_prompt: string | null;
};

export type ContextualHelpBundle = {
  mapping: HelpContextMappingRow | null;
  articles: HelpArticleRow[];
  faqs: HelpFaqRow[];
  glossaryTerms: HelpGlossaryRow[];
};

function audienceMatches(
  audience: string,
  ctx: HelpContextPayload,
): boolean {
  if (audience === "all" || audience === "public") return true;
  const sys = (ctx.system_role ?? "").toLowerCase();
  const prof = (ctx.profile_system_role ?? "").toLowerCase();
  const wr = (ctx.workspace_role ?? "").toLowerCase();
  if (audience === "system_admin") return sys === "system_admin";
  if (audience === "learning_consultant") return prof === "learning_consultant";
  if (audience === "company_admin") {
    return [
      "company_owner",
      "company_admin",
      "company_it_admin",
      "learning_lead",
    ].includes(wr);
  }
  if (audience === "member") return true;
  return true;
}

/** Load context mapping row for surface + page (+ optional feature). */
export async function fetchHelpContextMapping(
  client: SupabaseClient,
  surface: HelpSurface,
  page_key: string,
  feature_key?: string | null,
): Promise<HelpContextMappingRow | null> {
  const surfaces: string[] =
    surface === "both" ? ["both"] : [surface, "both"];

  let q = client
    .from("help_context_mappings")
    .select(
      "id, surface, page_key, feature_key, default_article_ids, default_faq_ids, starter_prompt",
    )
    .in("surface", surfaces)
    .eq("page_key", page_key);

  if (feature_key) {
    q = q.eq("feature_key", feature_key);
  } else {
    q = q.is("feature_key", null);
  }

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as HelpContextMappingRow) ?? null;
}

/** Priority 1–3: mapped IDs → page match → broader published. */
export async function fetchContextualHelpBundle(
  client: SupabaseClient,
  ctx: HelpContextPayload,
): Promise<ContextualHelpBundle> {
  const page = ctx.page_key ?? "dashboard";
  const surface = ctx.surface ?? "app";

  const mapping = await fetchHelpContextMapping(
    client,
    surface,
    page,
    ctx.feature_key,
  );

  const articles: HelpArticleRow[] = [];
  const faqs: HelpFaqRow[] = [];

  if (mapping?.default_article_ids?.length) {
    const { data: a } = await client
      .from("help_articles")
      .select(
        "id, slug, title, summary, body_markdown, article_type, audience, related_surface, related_page_key, related_feature_key, status",
      )
      .in("id", mapping.default_article_ids)
      .eq("status", "published");
    if (a?.length) {
      for (const row of a as HelpArticleRow[]) {
        if (audienceMatches(row.audience, ctx)) articles.push(row);
      }
    }
  }

  if (mapping?.default_faq_ids?.length) {
    const { data: f } = await client
      .from("help_faqs")
      .select("id, question, answer, related_surface, related_page_key, status")
      .in("id", mapping.default_faq_ids)
      .eq("status", "published");
    if (f?.length) faqs.push(...(f as HelpFaqRow[]));
  }

  if (articles.length === 0) {
    const { data: byPage } = await client
      .from("help_articles")
      .select(
        "id, slug, title, summary, body_markdown, article_type, audience, related_surface, related_page_key, related_feature_key, status",
      )
      .eq("status", "published")
      .in("related_surface", [surface, "both"])
      .eq("related_page_key", page)
      .limit(8);
    for (const row of (byPage ?? []) as HelpArticleRow[]) {
      if (audienceMatches(row.audience, ctx)) articles.push(row);
    }
  }

  if (articles.length === 0) {
    const { data: broad } = await client
      .from("help_articles")
      .select(
        "id, slug, title, summary, body_markdown, article_type, audience, related_surface, related_page_key, related_feature_key, status",
      )
      .eq("status", "published")
      .in("related_surface", [surface, "both"])
      .is("related_page_key", null)
      .limit(6);
    for (const row of (broad ?? []) as HelpArticleRow[]) {
      if (audienceMatches(row.audience, ctx)) articles.push(row);
    }
  }

  if (faqs.length === 0) {
    const { data: fqPage } = await client
      .from("help_faqs")
      .select("id, question, answer, related_surface, related_page_key, status")
      .eq("status", "published")
      .in("related_surface", [surface, "both"])
      .eq("related_page_key", page)
      .limit(6);
    if (fqPage?.length) faqs.push(...(fqPage as HelpFaqRow[]));
  }

  if (faqs.length === 0) {
    const { data: fqBroad } = await client
      .from("help_faqs")
      .select("id, question, answer, related_surface, related_page_key, status")
      .eq("status", "published")
      .in("related_surface", [surface, "both"])
      .is("related_page_key", null)
      .limit(4);
    if (fqBroad?.length) faqs.push(...(fqBroad as HelpFaqRow[]));
  }

  const { data: gloss } = await client
    .from("help_glossary_terms")
    .select("id, term, definition, aliases, status")
    .eq("status", "published")
    .limit(12);

  return {
    mapping,
    articles: articles.slice(0, 12),
    faqs: faqs.slice(0, 12),
    glossaryTerms: (gloss ?? []) as HelpGlossaryRow[],
  };
}

export type GroundedHelpAnswer = {
  reply: string;
  sources: { type: "article" | "faq" | "glossary"; id: string; title: string }[];
};

/** Build a non-hallucinated reply from published excerpts only. */
export function composeGroundedReply(
  bundle: ContextualHelpBundle,
  userQuestion: string,
): GroundedHelpAnswer {
  void userQuestion;
  const sources: GroundedHelpAnswer["sources"] = [];
  const parts: string[] = [];

  if (bundle.mapping?.starter_prompt) {
    parts.push(`**Suggested topics:** ${bundle.mapping.starter_prompt}`);
  }

  for (const a of bundle.articles.slice(0, 4)) {
    const excerpt = (a.summary ?? a.body_markdown ?? "").slice(0, 500);
    if (excerpt.trim()) {
      parts.push(`### ${a.title}\n${excerpt.trim()}`);
      sources.push({ type: "article", id: a.id, title: a.title });
    }
  }

  for (const f of bundle.faqs.slice(0, 4)) {
    parts.push(`**Q:** ${f.question}\n**A:** ${f.answer.slice(0, 400)}`);
    sources.push({ type: "faq", id: f.id, title: f.question.slice(0, 80) });
  }

  for (const g of bundle.glossaryTerms.slice(0, 5)) {
    parts.push(`**${g.term}:** ${g.definition.slice(0, 280)}`);
    sources.push({ type: "glossary", id: g.id, title: g.term });
  }

  if (parts.length === 0) {
    return {
      reply:
        "No published help articles matched this context yet. Check the Help Center after your administrator publishes content.",
      sources: [],
    };
  }

  return {
    reply: parts.join("\n\n---\n\n"),
    sources,
  };
}

export async function answerHelpQuestion(
  client: SupabaseClient,
  ctx: HelpContextPayload,
  question: string,
): Promise<GroundedHelpAnswer> {
  const bundle = await fetchContextualHelpBundle(client, ctx);
  return composeGroundedReply(bundle, question);
}

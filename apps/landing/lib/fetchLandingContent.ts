import { FALLBACK_LANDING } from "./fallbackLanding";
import { getHelpApiUrl } from "./env";
import type { HelpArticle, HelpContextMapping, LandingContent } from "./types";
import { SECTION_KEYS, type SectionKey } from "./types";

function isLandingArticle(a: { related_page_key: string | null; related_feature_key: string | null }): boolean {
  if (a.related_page_key?.trim() === "landing") return true;
  const fk = a.related_feature_key?.trim();
  return Boolean(fk && SECTION_KEYS.includes(fk as SectionKey));
}

function stripMd(s: string): string {
  return s
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function firstParagraph(md: string | null | undefined): string {
  if (!md) return "";
  const lines = stripMd(md).split(/\n+/);
  return (lines[0] ?? "").slice(0, 280);
}

/** Merge Supabase help articles (by section_key) + context mapping into landing content. */
export function buildLandingFromApi(
  mapping: HelpContextMapping | null,
  articles: HelpArticle[],
  fallback: LandingContent,
): LandingContent {
  const byFeature = new Map<string, HelpArticle>();
  for (const a of articles) {
    const key = a.related_feature_key?.trim();
    if (key && SECTION_KEYS.includes(key as SectionKey)) {
      byFeature.set(key, a);
    }
  }

  const heroArt = byFeature.get("landing_hero");
  const valueArt = byFeature.get("landing_value");
  const featuresArt = byFeature.get("landing_features");
  const ctaArt = byFeature.get("landing_cta");

  const heroSub =
    heroArt?.summary?.trim() ||
    firstParagraph(heroArt?.body_markdown) ||
    mapping?.starter_prompt?.trim() ||
    fallback.hero.subhead;

  const valueColumns = valueArt
    ? parseValueColumns(valueArt.body_markdown, fallback.value.columns)
    : fallback.value.columns;

  const featureItems = featuresArt
    ? parseFeatureItems(featuresArt.body_markdown, fallback.features.items)
    : fallback.features.items;

  return {
    hero: {
      headline: heroArt?.title ?? fallback.hero.headline,
      subhead: heroSub,
      ctaPrimary: fallback.hero.ctaPrimary,
      ctaSecondary: fallback.hero.ctaSecondary,
    },
    value: { columns: valueColumns },
    howItWorks: fallback.howItWorks,
    features: { items: featureItems },
    useCases: fallback.useCases,
    cta: {
      headline: ctaArt?.title ?? fallback.cta.headline,
      subhead:
        ctaArt?.summary?.trim() ||
        firstParagraph(ctaArt?.body_markdown) ||
        fallback.cta.subhead,
    },
  };
}

function parseValueColumns(
  md: string | null | undefined,
  fb: LandingContent["value"]["columns"],
): LandingContent["value"]["columns"] {
  if (!md?.trim()) return fb;
  const blocks = md.split(/\n##\s+/).filter(Boolean);
  const out: { title: string; body: string }[] = [];
  for (const b of blocks) {
    const [head, ...rest] = b.split("\n");
    const title = stripMd(head).replace(/^#+\s*/, "") || "—";
    const body = stripMd(rest.join("\n")).trim() || "—";
    if (title && body) out.push({ title, body });
  }
  return out.length >= 3 ? out.slice(0, 3) : fb;
}

function parseFeatureItems(
  md: string | null | undefined,
  fb: LandingContent["features"]["items"],
): LandingContent["features"]["items"] {
  if (!md?.trim()) return fb;
  const blocks = md.split(/\n##\s+/).filter(Boolean);
  const out: { title: string; body: string }[] = [];
  for (const b of blocks) {
    const [head, ...rest] = b.split("\n");
    const title = stripMd(head).replace(/^#+\s*/, "") || "—";
    const body = stripMd(rest.join("\n")).trim() || "—";
    if (title && body) out.push({ title, body });
  }
  return out.length ? out : fb;
}

export async function fetchLandingContent(): Promise<{
  content: LandingContent;
  usedApi: boolean;
}> {
  const api = getHelpApiUrl();
  if (!api) {
    return { content: FALLBACK_LANDING, usedApi: false };
  }

  try {
    const ctxUrl = `${api}?action=context&surface=website&page_key=landing`;
    const artUrl = `${api}?action=articles&surface=website`;

    const [ctxRes, artRes] = await Promise.all([
      fetch(ctxUrl, { next: { revalidate: 120 } }),
      fetch(artUrl, { next: { revalidate: 120 } }),
    ]);

    if (!ctxRes.ok || !artRes.ok) {
      return { content: FALLBACK_LANDING, usedApi: false };
    }

    const ctxJson = (await ctxRes.json()) as { mapping: HelpContextMapping | null };
    const artJson = (await artRes.json()) as { articles: HelpArticle[] };

    const articles = (artJson.articles ?? []).filter(isLandingArticle);

    const merged = buildLandingFromApi(
      ctxJson.mapping ?? null,
      articles,
      FALLBACK_LANDING,
    );
    return { content: merged, usedApi: true };
  } catch {
    return { content: FALLBACK_LANDING, usedApi: false };
  }
}

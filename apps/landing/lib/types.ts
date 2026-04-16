export type HelpArticle = {
  id: string;
  slug?: string;
  title: string;
  summary: string | null;
  body_markdown: string | null;
  related_page_key: string | null;
  related_feature_key: string | null;
};

export type HelpContextMapping = {
  id?: string;
  starter_prompt: string | null;
  default_article_ids?: string[];
  page_key?: string;
};

export type LandingContent = {
  hero: {
    headline: string;
    subhead: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  value: { columns: { title: string; body: string }[] };
  howItWorks: { steps: { title: string; body: string }[] };
  features: { items: { title: string; body: string }[] };
  useCases: { items: { title: string; body: string }[] };
  cta: { headline: string; subhead: string };
};

export const SECTION_KEYS = [
  "landing_hero",
  "landing_value",
  "landing_features",
  "landing_cta",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

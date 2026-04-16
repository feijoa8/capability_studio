-- Help Center: articles, FAQs, glossary, context mappings, change queue.
-- Source of truth for in-app + website help; chatbot reads published rows only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  summary text,
  body_markdown text,
  article_type text NOT NULL DEFAULT 'page_guide'
    CHECK (article_type IN (
      'page_guide', 'feature_guide', 'onboarding', 'troubleshooting', 'website_content'
    )),
  audience text NOT NULL DEFAULT 'all'
    CHECK (audience IN ('member', 'company_admin', 'system_admin', 'public', 'all')),
  related_surface text NOT NULL DEFAULT 'app'
    CHECK (related_surface IN ('app', 'website', 'both')),
  related_page_key text,
  related_feature_key text,
  related_role text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  version int NOT NULL DEFAULT 1,
  generated_from text,
  last_reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT help_articles_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS help_articles_status_surface_idx
  ON public.help_articles (status, related_surface);
CREATE INDEX IF NOT EXISTS help_articles_page_key_idx
  ON public.help_articles (related_page_key)
  WHERE related_page_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.help_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  related_surface text NOT NULL DEFAULT 'app'
    CHECK (related_surface IN ('app', 'website', 'both')),
  related_page_key text,
  related_feature_key text,
  related_role text,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS help_faqs_status_surface_idx
  ON public.help_faqs (status, related_surface);

CREATE TABLE IF NOT EXISTS public.help_glossary_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  definition text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  related_terms text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS help_glossary_terms_term_lower_uq
  ON public.help_glossary_terms (lower(trim(term)));

CREATE TABLE IF NOT EXISTS public.help_context_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface text NOT NULL CHECK (surface IN ('app', 'website', 'both')),
  page_key text NOT NULL,
  feature_key text,
  default_article_ids uuid[] NOT NULL DEFAULT '{}',
  default_faq_ids uuid[] NOT NULL DEFAULT '{}',
  starter_prompt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT help_context_mappings_unique_ctx UNIQUE (surface, page_key, feature_key)
);

CREATE INDEX IF NOT EXISTS help_context_mappings_lookup_idx
  ON public.help_context_mappings (surface, page_key);

CREATE TABLE IF NOT EXISTS public.help_change_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_key text NOT NULL,
  detected_change_summary text,
  proposed_draft_payload jsonb,
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'accepted', 'rejected', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Touch updated_at
CREATE OR REPLACE FUNCTION public.help_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- PL/pgSQL trigger functions must be declared with RETURNS trigger (above).

DROP TRIGGER IF EXISTS help_articles_touch_trg ON public.help_articles;
CREATE TRIGGER help_articles_touch_trg
  BEFORE UPDATE ON public.help_articles
  FOR EACH ROW EXECUTE PROCEDURE public.help_touch_updated_at();

DROP TRIGGER IF EXISTS help_faqs_touch_trg ON public.help_faqs;
CREATE TRIGGER help_faqs_touch_trg
  BEFORE UPDATE ON public.help_faqs
  FOR EACH ROW EXECUTE PROCEDURE public.help_touch_updated_at();

DROP TRIGGER IF EXISTS help_glossary_touch_trg ON public.help_glossary_terms;
CREATE TRIGGER help_glossary_touch_trg
  BEFORE UPDATE ON public.help_glossary_terms
  FOR EACH ROW EXECUTE PROCEDURE public.help_touch_updated_at();

DROP TRIGGER IF EXISTS help_context_mappings_touch_trg ON public.help_context_mappings;
CREATE TRIGGER help_context_mappings_touch_trg
  BEFORE UPDATE ON public.help_context_mappings
  FOR EACH ROW EXECUTE PROCEDURE public.help_touch_updated_at();

DROP TRIGGER IF EXISTS help_change_queue_touch_trg ON public.help_change_queue;
CREATE TRIGGER help_change_queue_touch_trg
  BEFORE UPDATE ON public.help_change_queue
  FOR EACH ROW EXECUTE PROCEDURE public.help_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_glossary_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_context_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_change_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "help_articles_select_auth" ON public.help_articles;
CREATE POLICY "help_articles_select_auth"
  ON public.help_articles FOR SELECT TO authenticated
  USING (
    status = 'published'
    OR public.is_reference_library_admin()
  );

DROP POLICY IF EXISTS "help_articles_select_anon" ON public.help_articles;
CREATE POLICY "help_articles_select_anon"
  ON public.help_articles FOR SELECT TO anon
  USING (
    status = 'published'
    AND related_surface IN ('website', 'both')
    AND audience IN ('public', 'all')
  );

DROP POLICY IF EXISTS "help_articles_write_admin" ON public.help_articles;
CREATE POLICY "help_articles_write_admin"
  ON public.help_articles FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

DROP POLICY IF EXISTS "help_faqs_select_auth" ON public.help_faqs;
CREATE POLICY "help_faqs_select_auth"
  ON public.help_faqs FOR SELECT TO authenticated
  USING (status = 'published' OR public.is_reference_library_admin());

DROP POLICY IF EXISTS "help_faqs_select_anon" ON public.help_faqs;
CREATE POLICY "help_faqs_select_anon"
  ON public.help_faqs FOR SELECT TO anon
  USING (
    status = 'published'
    AND related_surface IN ('website', 'both')
  );

DROP POLICY IF EXISTS "help_faqs_write_admin" ON public.help_faqs;
CREATE POLICY "help_faqs_write_admin"
  ON public.help_faqs FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

DROP POLICY IF EXISTS "help_glossary_select_auth" ON public.help_glossary_terms;
CREATE POLICY "help_glossary_select_auth"
  ON public.help_glossary_terms FOR SELECT TO authenticated
  USING (status = 'published' OR public.is_reference_library_admin());

DROP POLICY IF EXISTS "help_glossary_select_anon" ON public.help_glossary_terms;
CREATE POLICY "help_glossary_select_anon"
  ON public.help_glossary_terms FOR SELECT TO anon
  USING (status = 'published');

DROP POLICY IF EXISTS "help_glossary_write_admin" ON public.help_glossary_terms;
CREATE POLICY "help_glossary_write_admin"
  ON public.help_glossary_terms FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

DROP POLICY IF EXISTS "help_context_select_auth" ON public.help_context_mappings;
CREATE POLICY "help_context_select_auth"
  ON public.help_context_mappings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "help_context_select_anon" ON public.help_context_mappings;
CREATE POLICY "help_context_select_anon"
  ON public.help_context_mappings FOR SELECT TO anon
  USING (surface IN ('website', 'both'));

DROP POLICY IF EXISTS "help_context_write_admin" ON public.help_context_mappings;
CREATE POLICY "help_context_write_admin"
  ON public.help_context_mappings FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

DROP POLICY IF EXISTS "help_change_queue_all_admin" ON public.help_change_queue;
CREATE POLICY "help_change_queue_all_admin"
  ON public.help_change_queue FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

COMMENT ON TABLE public.help_articles IS 'Published help content; chatbot answers from these rows, not vice versa.';
COMMENT ON TABLE public.help_change_queue IS 'Draft proposals from tooling; never auto-published.';

-- Draft help seeds (manual review + publish). Idempotent via slug / page_key checks.

INSERT INTO public.help_articles (
  slug, title, summary, body_markdown, article_type, audience, related_surface,
  related_page_key, related_feature_key, status, version, generated_from
)
SELECT v.*
FROM (VALUES
  (
    'guide-dashboard',
    'Personal dashboard',
    'Your home view for development focus and linked insights.',
    E'# Dashboard\n\nUse **My Dashboard** to see your role, goals, and organisation-linked industry insights.\n',
    'page_guide', 'all', 'app', 'dashboard', NULL, 'draft', 1, 'seed_migration'
  ),
  (
    'guide-my-competencies',
    'My Competencies',
    'Track assessed competencies and gaps for your current role.',
    E'# My Competencies\n\nReview proficiency levels and development goals tied to your job profile.\n',
    'page_guide', 'member', 'app', 'my_competencies', NULL, 'draft', 1, 'seed_migration'
  ),
  (
    'guide-competency-management',
    'Competency Management',
    'Org taxonomy: capability areas, subjects, competencies, and practices.',
    E'# Competency Management\n\nAdmins maintain the organisation capability model and governance.\n',
    'feature_guide', 'company_admin', 'app', 'competency_management', NULL, 'draft', 1, 'seed_migration'
  ),
  (
    'guide-starter-packs',
    'Starter packs',
    'Adopt reference starter packs into your organisation taxonomy.',
    E'# Starter packs\n\nBrowse published packs and adopt subjects/competencies into your org model.\n',
    'feature_guide', 'company_admin', 'app', 'starter_packs', NULL, 'draft', 1, 'seed_migration'
  ),
  (
    'guide-reference-library',
    'System Reference Library',
    'Platform reference frameworks and starter pack administration.',
    E'# Reference library\n\nSystem administrators curate shared reference content.\n',
    'feature_guide', 'system_admin', 'app', 'system_reference_library', NULL, 'draft', 1, 'seed_migration'
  ),
  (
    'website-what-is-capability-hub',
    'What is Capability Hub?',
    'Capability intelligence for people and organisations.',
    E'# Capability Hub\n\nConnect job profiles, competencies, and development in one place.\n',
    'website_content', 'public', 'website', 'landing', NULL, 'draft', 1, 'seed_migration'
  )
) AS v(slug, title, summary, body_markdown, article_type, audience, related_surface, related_page_key, related_feature_key, status, version, generated_from)
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_articles a WHERE a.slug = v.slug
);

INSERT INTO public.help_faqs (question, answer, related_surface, related_page_key, status, tags)
SELECT v.*
FROM (VALUES
  (
    'What is a starter pack?',
    'A starter pack is a curated bundle of reference subjects and competencies you can adopt into your organisation.',
    'both', 'starter_packs', 'draft', ARRAY['starter_pack', 'reference']::text[]
  ),
  (
    'Who is Capability Hub for?',
    'Individuals tracking capability, teams, and organisations aligning roles to a shared competency model.',
    'website', 'landing', 'draft', ARRAY['general']::text[]
  )
) AS v(question, answer, related_surface, related_page_key, status, tags)
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_faqs f WHERE f.question = v.question
);

INSERT INTO public.help_glossary_terms (term, definition, aliases, related_terms, status)
SELECT v.*
FROM (VALUES
  (
    'Capability area',
    'A grouping layer for competency subjects within an organisation.',
    ARRAY['capability areas']::text[],
    ARRAY['subject', 'practice']::text[],
    'draft'
  ),
  (
    'Subject',
    'A topic area under a capability area; holds related competencies.',
    ARRAY[]::text[],
    ARRAY['competency', 'capability area']::text[],
    'draft'
  ),
  (
    'Competency',
    'A defined skill or knowledge area that can be assessed and developed.',
    ARRAY[]::text[],
    ARRAY['subject', 'practice']::text[],
    'draft'
  ),
  (
    'Practice',
    'An organisational practice area used to group and refine competency content.',
    ARRAY[]::text[],
    ARRAY['subject', 'competency']::text[],
    'draft'
  ),
  (
    'Starter pack',
    'A published bundle of reference subjects and competencies for adoption.',
    ARRAY['starter packs']::text[],
    ARRAY['reference library', 'adoption']::text[],
    'draft'
  ),
  (
    'Reference library',
    'Shared platform reference frameworks and taxonomy managed by system administrators.',
    ARRAY['reference']::text[],
    ARRAY['starter pack', 'framework']::text[],
    'draft'
  ),
  (
    'System admin',
    'Platform-level administrator for shared reference content (not org-only admin).',
    ARRAY['system administrator']::text[],
    ARRAY['company admin']::text[],
    'draft'
  )
) AS v(term, definition, aliases, related_terms, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_glossary_terms g WHERE lower(trim(g.term)) = lower(trim(v.term))
);

INSERT INTO public.help_context_mappings (surface, page_key, feature_key, default_article_ids, default_faq_ids, starter_prompt)
SELECT v.*
FROM (VALUES
  ('app', 'dashboard', NULL, '{}'::uuid[], '{}'::uuid[], 'Help with my dashboard and development focus.'),
  ('app', 'starter_packs', NULL, '{}'::uuid[], '{}'::uuid[], 'Help with starter packs and adoption.'),
  ('app', 'system_reference_library', NULL, '{}'::uuid[], '{}'::uuid[], 'Help with system reference library.'),
  ('website', 'landing', NULL, '{}'::uuid[], '{}'::uuid[], 'What is Capability Hub and who is it for?')
) AS v(surface, page_key, feature_key, default_article_ids, default_faq_ids, starter_prompt)
WHERE NOT EXISTS (
  SELECT 1 FROM public.help_context_mappings m
  WHERE m.surface = v.surface AND m.page_key = v.page_key
    AND m.feature_key IS NOT DISTINCT FROM v.feature_key
);

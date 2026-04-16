-- User-facing rename: Capability Hub -> Capability Studio (website / help seeds only).

UPDATE public.help_articles
SET
  title = 'What is Capability Studio?',
  summary = 'Capability intelligence for people and organisations.',
  body_markdown = E'# Capability Studio\n\nConnect job profiles, competencies, and development in one place.\n'
WHERE slug = 'website-what-is-capability-hub';

UPDATE public.help_faqs
SET question = 'Who is Capability Studio for?'
WHERE question = 'Who is Capability Hub for?';

-- Evidence tags: methods/practices and tools/platforms on work roles and projects.
-- Skills and industry columns already exist; this adds structured buckets for analytics
-- and future AI enrichment without a separate link table (Option A — evidence-first).

ALTER TABLE public.user_experience
  ADD COLUMN IF NOT EXISTS methods text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.user_experience
  ADD COLUMN IF NOT EXISTS tools text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.user_experience_projects
  ADD COLUMN IF NOT EXISTS methods text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.user_experience_projects
  ADD COLUMN IF NOT EXISTS tools text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.user_experience.methods IS
  'Named delivery approaches / practices (e.g. Scrum, Design Thinking), evidence-linked.';

COMMENT ON COLUMN public.user_experience.tools IS
  'Named systems or platforms (e.g. Jira, Miro), evidence-linked.';

COMMENT ON COLUMN public.user_experience_projects.methods IS
  'Project-level practice tags; same semantics as user_experience.methods.';

COMMENT ON COLUMN public.user_experience_projects.tools IS
  'Project-level tool tags; same semantics as user_experience.tools.';

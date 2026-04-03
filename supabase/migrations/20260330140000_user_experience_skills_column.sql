-- Canonical `skills` text[] on user_experience (aligns with user_experience_projects.skills).
-- Older migrations may have added `skill_tags` only; backfill when both exist.

ALTER TABLE public.user_experience
  ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_experience'
      AND column_name = 'skill_tags'
  ) THEN
    UPDATE public.user_experience SET skills = skill_tags
    WHERE skills = '{}'::text[]
      AND skill_tags IS NOT NULL
      AND skill_tags <> '{}'::text[];
  END IF;
END $$;

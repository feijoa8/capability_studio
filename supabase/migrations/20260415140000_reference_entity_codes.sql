-- Optional code fields for reference taxonomy (admin UI). Live deployments may already have these.
ALTER TABLE public.reference_capability_areas
  ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.reference_subjects
  ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.reference_competencies
  ADD COLUMN IF NOT EXISTS code text;

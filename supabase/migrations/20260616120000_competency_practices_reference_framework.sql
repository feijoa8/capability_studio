-- Optional reference framework label for practice-context AI alignment (e.g. BABOK, Scrum Guide).

ALTER TABLE public.competency_practices
  ADD COLUMN IF NOT EXISTS reference_framework text;

COMMENT ON COLUMN public.competency_practices.reference_framework IS
  'Optional label for alignment (e.g. BABOK v3, Scrum Guide 2020). Practices remain contextual; taxonomy is unchanged.';

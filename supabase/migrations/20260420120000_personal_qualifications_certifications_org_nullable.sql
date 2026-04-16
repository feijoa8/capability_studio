-- Personal Account: store qualifications and certifications without a workspace org id.
-- Workspace rows keep organisation_id set; personal rows use NULL (same pattern as user_cv_uploads).

ALTER TABLE public.user_qualifications
  ALTER COLUMN organisation_id DROP NOT NULL;

ALTER TABLE public.user_certifications
  ALTER COLUMN organisation_id DROP NOT NULL;

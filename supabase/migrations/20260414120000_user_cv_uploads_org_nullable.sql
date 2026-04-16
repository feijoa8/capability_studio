-- Allow CV uploads without a workspace (personal-account profile prefill).

ALTER TABLE public.user_cv_uploads
  ALTER COLUMN organisation_id DROP NOT NULL;

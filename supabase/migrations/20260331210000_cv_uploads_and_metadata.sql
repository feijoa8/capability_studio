-- Stored CV files (optional) + metadata for My Experience import (Phase 1)

CREATE TABLE IF NOT EXISTS public.user_cv_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type text,
  file_size_bytes bigint,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_cv_uploads_user_org_idx
  ON public.user_cv_uploads (user_id, organisation_id);

CREATE INDEX IF NOT EXISTS user_cv_uploads_uploaded_at_idx
  ON public.user_cv_uploads (uploaded_at DESC);

ALTER TABLE public.user_cv_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_cv_uploads_select_own" ON public.user_cv_uploads;
DROP POLICY IF EXISTS "user_cv_uploads_insert_own" ON public.user_cv_uploads;
DROP POLICY IF EXISTS "user_cv_uploads_delete_own" ON public.user_cv_uploads;

CREATE POLICY "user_cv_uploads_select_own"
  ON public.user_cv_uploads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_cv_uploads_insert_own"
  ON public.user_cv_uploads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_cv_uploads_delete_own"
  ON public.user_cv_uploads FOR DELETE
  USING (auth.uid() = user_id);

-- Bucket: path {user_id}/{uuid}_{filename}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cv-uploads',
  'cv-uploads',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "cv_uploads_select_own_folder"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'cv-uploads'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  );

CREATE POLICY "cv_uploads_insert_own_folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'cv-uploads'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  );

CREATE POLICY "cv_uploads_update_own_folder"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'cv-uploads'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'cv-uploads'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  );

CREATE POLICY "cv_uploads_delete_own_folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'cv-uploads'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  );

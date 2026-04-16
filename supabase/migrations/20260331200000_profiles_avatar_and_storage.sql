-- Profile avatar URL (public image URL after upload to Storage)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Bucket for user profile images: path pattern {user_id}/{filename}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-images',
  'profile-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies: objects in profile-images
CREATE POLICY "profile_images_select_public"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'profile-images');

CREATE POLICY "profile_images_insert_own_folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'profile-images'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  );

CREATE POLICY "profile_images_update_own_folder"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'profile-images'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  );

CREATE POLICY "profile_images_delete_own_folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND split_part(name::text, '/', 1) = auth.uid()::text
  );

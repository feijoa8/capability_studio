-- Optional profile fields for My Profile (V1); extend existing public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS linkedin_url text;

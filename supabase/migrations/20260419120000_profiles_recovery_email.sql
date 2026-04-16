-- Optional recovery / alternate contact email (distinct from auth sign-in email).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS recovery_email text;

COMMENT ON COLUMN public.profiles.recovery_email IS
  'Optional. Personal fallback for recovery and continuity; not the Supabase auth sign-in email.';

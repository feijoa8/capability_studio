-- Personal vs organisation-led account intent (account setup completion).
-- Used when the user has no workspace yet but should still use My Profile and personal areas.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS primary_account_type text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_primary_account_type_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_primary_account_type_check
  CHECK (
    primary_account_type IS NULL
    OR primary_account_type IN ('personal', 'organisation')
  );

COMMENT ON COLUMN public.profiles.primary_account_type IS
  'personal = completed setup as an individual; organisation = user chose workspace-led completion (may not have a membership yet). NULL = legacy / not set via account setup.';

-- Own-row access to public.profiles for authenticated users (account setup, My Profile, ensureUserProfile).
-- SECURITY DEFINER functions and service_role continue to bypass RLS.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Idempotent: replace this migration’s policy set
DROP POLICY IF EXISTS "profiles_own_row_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_row_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_own_row_update" ON public.profiles;

-- Drop common Supabase starter / dashboard template names if present (often overly broad or missing INSERT).
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "profiles_own_row_select"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_own_row_insert"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_own_row_update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

COMMENT ON POLICY "profiles_own_row_select" ON public.profiles IS
  'Authenticated users may read only their profile row (id = auth.uid()).';

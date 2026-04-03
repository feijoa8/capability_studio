-- My Experience V1: structured work evidence + qualifications (user-scoped)

CREATE TABLE IF NOT EXISTS public.user_experience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role_title text,
  organisation_name text,
  description text
);

ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS skill_tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.user_experience ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS user_experience_user_idx ON public.user_experience (user_id);

CREATE TABLE IF NOT EXISTS public.user_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  issuer text,
  earned_date date,
  expiry_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_qualifications_user_idx ON public.user_qualifications (user_id);

ALTER TABLE public.user_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_qualifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_experience_select_own" ON public.user_experience;
DROP POLICY IF EXISTS "user_experience_insert_own" ON public.user_experience;
DROP POLICY IF EXISTS "user_experience_update_own" ON public.user_experience;
DROP POLICY IF EXISTS "user_experience_delete_own" ON public.user_experience;

CREATE POLICY "user_experience_select_own"
  ON public.user_experience FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_experience_insert_own"
  ON public.user_experience FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_experience_update_own"
  ON public.user_experience FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_experience_delete_own"
  ON public.user_experience FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_qualifications_select_own" ON public.user_qualifications;
DROP POLICY IF EXISTS "user_qualifications_insert_own" ON public.user_qualifications;
DROP POLICY IF EXISTS "user_qualifications_update_own" ON public.user_qualifications;
DROP POLICY IF EXISTS "user_qualifications_delete_own" ON public.user_qualifications;

CREATE POLICY "user_qualifications_select_own"
  ON public.user_qualifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_qualifications_insert_own"
  ON public.user_qualifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_qualifications_update_own"
  ON public.user_qualifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_qualifications_delete_own"
  ON public.user_qualifications FOR DELETE
  USING (auth.uid() = user_id);

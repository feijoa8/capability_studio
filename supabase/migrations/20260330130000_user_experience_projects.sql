-- Optional project-level detail under user_experience (consulting / delivery); UI deferred

CREATE TABLE IF NOT EXISTS public.user_experience_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experience_id uuid NOT NULL REFERENCES public.user_experience (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  project_name text,
  client text,
  role text,
  description text,
  start_date date,
  end_date date,
  skills text[] NOT NULL DEFAULT '{}'::text[],
  industry text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_experience_projects_experience_idx
  ON public.user_experience_projects (experience_id);

CREATE INDEX IF NOT EXISTS user_experience_projects_user_idx
  ON public.user_experience_projects (user_id);

ALTER TABLE public.user_experience_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_experience_projects_select_own" ON public.user_experience_projects;
DROP POLICY IF EXISTS "user_experience_projects_insert_own" ON public.user_experience_projects;
DROP POLICY IF EXISTS "user_experience_projects_update_own" ON public.user_experience_projects;
DROP POLICY IF EXISTS "user_experience_projects_delete_own" ON public.user_experience_projects;

CREATE POLICY "user_experience_projects_select_own"
  ON public.user_experience_projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_experience_projects_insert_own"
  ON public.user_experience_projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_experience_projects_update_own"
  ON public.user_experience_projects FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_experience_projects_delete_own"
  ON public.user_experience_projects FOR DELETE
  USING (auth.uid() = user_id);

-- Personal Application Evaluations: saved job posting analysis vs My Experience evidence.

CREATE TABLE IF NOT EXISTS public.application_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready')),
  title_hint text,
  company_hint text,
  source_url text,
  raw_description text NOT NULL,
  role_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_snapshot jsonb,
  comparison_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_evaluations_user_updated_idx
  ON public.application_evaluations (user_id, updated_at DESC);

ALTER TABLE public.application_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "application_evaluations_select_own" ON public.application_evaluations;
DROP POLICY IF EXISTS "application_evaluations_insert_own" ON public.application_evaluations;
DROP POLICY IF EXISTS "application_evaluations_update_own" ON public.application_evaluations;
DROP POLICY IF EXISTS "application_evaluations_delete_own" ON public.application_evaluations;

CREATE POLICY "application_evaluations_select_own"
  ON public.application_evaluations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "application_evaluations_insert_own"
  ON public.application_evaluations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "application_evaluations_update_own"
  ON public.application_evaluations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "application_evaluations_delete_own"
  ON public.application_evaluations FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.application_evaluations_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS application_evaluations_touch_updated_at_trg
  ON public.application_evaluations;
CREATE TRIGGER application_evaluations_touch_updated_at_trg
  BEFORE UPDATE ON public.application_evaluations
  FOR EACH ROW
  EXECUTE PROCEDURE public.application_evaluations_touch_updated_at();

COMMENT ON TABLE public.application_evaluations IS
  'Personal job posting evaluations: raw posting, AI role extraction, evidence comparison.';

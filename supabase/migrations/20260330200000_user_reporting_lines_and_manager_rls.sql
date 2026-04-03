-- Reporting lines: who reports to whom (per organisation). Enables manager visibility of team development plans.
drop policy if exists "development_plans_select_own" on public.development_plans;
drop policy if exists "development_plans_insert_own" on public.development_plans;
drop policy if exists "development_plans_update_own" on public.development_plans;
drop policy if exists "development_plans_delete_own" on public.development_plans;

drop policy if exists "development_plan_objectives_select_own" on public.development_plan_objectives;
drop policy if exists "development_plan_objectives_insert_own" on public.development_plan_objectives;
drop policy if exists "development_plan_objectives_update_own" on public.development_plan_objectives;
drop policy if exists "development_plan_objectives_delete_own" on public.development_plan_objectives;

CREATE TABLE IF NOT EXISTS public.user_reporting_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  manager_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_reporting_lines_org_user_unique UNIQUE (organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_reporting_lines_manager_idx
  ON public.user_reporting_lines (organisation_id, manager_user_id);

CREATE INDEX IF NOT EXISTS user_reporting_lines_user_idx
  ON public.user_reporting_lines (organisation_id, user_id);

ALTER TABLE public.user_reporting_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_reporting_lines_select_own_or_manager"
  ON public.user_reporting_lines FOR SELECT
  USING (
    user_id = auth.uid()
    OR manager_user_id = auth.uid()
  );

CREATE POLICY "user_reporting_lines_insert_own"
  ON public.user_reporting_lines FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_reporting_lines_update_own"
  ON public.user_reporting_lines FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_reporting_lines_delete_own"
  ON public.user_reporting_lines FOR DELETE
  USING (user_id = auth.uid());

-- Prevent changing plan owner on update (manager may update status only)
CREATE OR REPLACE FUNCTION public.development_plans_immutable_user_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'development_plans.user_id cannot change';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS development_plans_immutable_user_id_trg ON public.development_plans;
CREATE TRIGGER development_plans_immutable_user_id_trg
  BEFORE UPDATE ON public.development_plans
  FOR EACH ROW
  EXECUTE PROCEDURE public.development_plans_immutable_user_id();

-- Drop existing plan/objective/note policies; replace with owner + manager visibility
DROP POLICY IF EXISTS "development_plans_select_own" ON public.development_plans;
DROP POLICY IF EXISTS "development_plans_update_own" ON public.development_plans;

CREATE POLICY "development_plans_select_own_or_team"
  ON public.development_plans FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_reporting_lines url
      WHERE url.organisation_id = development_plans.organisation_id
        AND url.manager_user_id = auth.uid()
        AND url.user_id = development_plans.user_id
    )
  );

CREATE POLICY "development_plans_insert_own"
  ON public.development_plans FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plans_update_owner_or_manager"
  ON public.development_plans FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_reporting_lines url
      WHERE url.organisation_id = development_plans.organisation_id
        AND url.manager_user_id = auth.uid()
        AND url.user_id = development_plans.user_id
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_reporting_lines url
      WHERE url.organisation_id = development_plans.organisation_id
        AND url.manager_user_id = auth.uid()
        AND url.user_id = development_plans.user_id
    )
  );

CREATE POLICY "development_plans_delete_own"
  ON public.development_plans FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "development_plan_objectives_select_own" ON public.development_plan_objectives;
DROP POLICY IF EXISTS "development_plan_objectives_update_own" ON public.development_plan_objectives;

CREATE POLICY "development_plan_objectives_select_own_or_team"
  ON public.development_plan_objectives FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_reporting_lines url
      WHERE url.organisation_id = development_plan_objectives.organisation_id
        AND url.manager_user_id = auth.uid()
        AND url.user_id = development_plan_objectives.user_id
    )
  );

CREATE POLICY "development_plan_objectives_insert_own"
  ON public.development_plan_objectives FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plan_objectives_update_own"
  ON public.development_plan_objectives FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plan_objectives_delete_own"
  ON public.development_plan_objectives FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "development_plan_objective_notes_select_own" ON public.development_plan_objective_notes;
DROP POLICY IF EXISTS "development_plan_objective_notes_insert_own" ON public.development_plan_objective_notes;
DROP POLICY IF EXISTS "development_plan_objective_notes_update_own" ON public.development_plan_objective_notes;
DROP POLICY IF EXISTS "development_plan_objective_notes_delete_own" ON public.development_plan_objective_notes;

CREATE POLICY "development_plan_objective_notes_select_own_or_team"
  ON public.development_plan_objective_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.development_plan_objectives o
      WHERE o.id = development_plan_objective_notes.development_plan_objective_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.user_reporting_lines url
            WHERE url.organisation_id = o.organisation_id
              AND url.manager_user_id = auth.uid()
              AND url.user_id = o.user_id
          )
        )
    )
  );

CREATE POLICY "development_plan_objective_notes_insert_own_or_manager_comment"
  ON public.development_plan_objective_notes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.development_plan_objectives o
        WHERE o.id = development_plan_objective_notes.development_plan_objective_id
          AND o.user_id = auth.uid()
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.development_plan_objectives o
          INNER JOIN public.user_reporting_lines url
            ON url.organisation_id = o.organisation_id
            AND url.user_id = o.user_id
            AND url.manager_user_id = auth.uid()
          WHERE o.id = development_plan_objective_notes.development_plan_objective_id
        )
        AND note_type = 'manager_comment'
      )
    )
  );

CREATE POLICY "development_plan_objective_notes_update_own"
  ON public.development_plan_objective_notes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plan_objective_notes_delete_own"
  ON public.development_plan_objective_notes FOR DELETE
  USING (user_id = auth.uid());

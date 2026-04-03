-- Objective progress notes; refine plan lifecycle status (draft → submitted → active …).

-- Notes on plan objectives (employee journaling; manager_comment reserved for future)
CREATE TABLE IF NOT EXISTS development_plan_objective_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  development_plan_objective_id uuid NOT NULL REFERENCES development_plan_objectives (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  note_type text NOT NULL DEFAULT 'update' CHECK (note_type IN ('update', 'blocker', 'reflection', 'manager_comment')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS development_plan_objective_notes_objective_idx
  ON development_plan_objective_notes (development_plan_objective_id);

CREATE INDEX IF NOT EXISTS development_plan_objective_notes_org_user_idx
  ON development_plan_objective_notes (organisation_id, user_id);

ALTER TABLE development_plan_objective_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "development_plan_objective_notes_select_own"
  ON development_plan_objective_notes FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "development_plan_objective_notes_insert_own"
  ON development_plan_objective_notes FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plan_objective_notes_update_own"
  ON development_plan_objective_notes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plan_objective_notes_delete_own"
  ON development_plan_objective_notes FOR DELETE
  USING (user_id = auth.uid());

-- Replace plan status: pending_review → submitted; constraint values: draft, submitted, active, completed, archived
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'development_plans'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.development_plans DROP CONSTRAINT %I', cname);
  END IF;
END $$;

UPDATE public.development_plans
SET status = 'submitted'
WHERE status = 'pending_review';

ALTER TABLE public.development_plans
  ADD CONSTRAINT development_plans_status_check
  CHECK (status IN ('draft', 'submitted', 'active', 'completed', 'archived'));

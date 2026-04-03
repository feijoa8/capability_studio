-- Formal development plans (annual / quarterly) and objectives; complements development_goals backlog/active pool.

CREATE TABLE IF NOT EXISTS development_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  manager_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  plan_type text NOT NULL DEFAULT 'annual' CHECK (plan_type IN ('annual', 'quarterly', 'custom')),
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'active', 'completed', 'archived')),
  employee_signed_at timestamptz,
  manager_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS development_plans_org_user_idx
  ON development_plans (organisation_id, user_id);

CREATE TABLE IF NOT EXISTS development_plan_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  development_plan_id uuid NOT NULL REFERENCES development_plans (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  source_goal_id uuid REFERENCES development_goals (id) ON DELETE SET NULL,
  competency_id uuid REFERENCES competencies (id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  success_criteria text,
  due_date date,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'pending_manager_review', 'completed', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS development_plan_objectives_plan_idx
  ON development_plan_objectives (development_plan_id);

CREATE INDEX IF NOT EXISTS development_plan_objectives_org_user_idx
  ON development_plan_objectives (organisation_id, user_id);

ALTER TABLE development_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "development_plans_select_own"
  ON development_plans FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "development_plans_insert_own"
  ON development_plans FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plans_update_own"
  ON development_plans FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plans_delete_own"
  ON development_plans FOR DELETE
  USING (user_id = auth.uid());

ALTER TABLE development_plan_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "development_plan_objectives_select_own"
  ON development_plan_objectives FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "development_plan_objectives_insert_own"
  ON development_plan_objectives FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plan_objectives_update_own"
  ON development_plan_objectives FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "development_plan_objectives_delete_own"
  ON development_plan_objectives FOR DELETE
  USING (user_id = auth.uid());

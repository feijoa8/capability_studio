-- Personal development goals (V1): user-scoped, competency-linked
CREATE TABLE IF NOT EXISTS development_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES competencies (id) ON DELETE CASCADE,
  current_level text NOT NULL,
  target_level text NOT NULL,
  relevance text NOT NULL DEFAULT 'medium' CHECK (relevance IN ('low', 'medium', 'high')),
  title text NOT NULL,
  description text,
  suggested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS development_goals_org_user_idx
  ON development_goals (organisation_id, user_id);

CREATE INDEX IF NOT EXISTS development_goals_competency_idx
  ON development_goals (organisation_id, competency_id);

ALTER TABLE development_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "development_goals_select"
  ON development_goals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "development_goals_insert"
  ON development_goals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "development_goals_update"
  ON development_goals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "development_goals_delete"
  ON development_goals FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

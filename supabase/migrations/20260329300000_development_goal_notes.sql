-- Lightweight progress notes on development goals (reflection + snapshot)
CREATE TABLE IF NOT EXISTS development_goal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES development_goals (id) ON DELETE CASCADE,
  note text NOT NULL,
  progress_snapshot integer NULL CHECK (
    progress_snapshot IS NULL
    OR (progress_snapshot >= 0 AND progress_snapshot <= 100)
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS development_goal_notes_goal_created_idx
  ON development_goal_notes (goal_id, created_at DESC);

ALTER TABLE development_goal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "development_goal_notes_select"
  ON development_goal_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM development_goals dg
      WHERE dg.id = development_goal_notes.goal_id
        AND EXISTS (
          SELECT 1 FROM workspace_memberships wm
          WHERE wm.organisation_id = dg.organisation_id
            AND wm.user_id = auth.uid()
        )
    )
  );

CREATE POLICY "development_goal_notes_insert"
  ON development_goal_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM development_goals dg
      WHERE dg.id = development_goal_notes.goal_id
        AND EXISTS (
          SELECT 1 FROM workspace_memberships wm
          WHERE wm.organisation_id = dg.organisation_id
            AND wm.user_id = auth.uid()
        )
        AND (
          dg.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_memberships wm2
            WHERE wm2.organisation_id = dg.organisation_id
              AND wm2.user_id = auth.uid()
              AND wm2.workspace_role IN ('company_admin', 'learning_lead')
          )
        )
    )
  );

-- Contributor assessment inputs (separate from org_user_competencies summary)
CREATE TABLE IF NOT EXISTS org_user_competency_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES competencies (id) ON DELETE CASCADE,
  contributor_type text NOT NULL,
  contributor_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  assessed_level text NOT NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_user_competency_assessments_org_user_idx
  ON org_user_competency_assessments (organisation_id, user_id);

CREATE INDEX IF NOT EXISTS org_user_competency_assessments_org_comp_idx
  ON org_user_competency_assessments (organisation_id, competency_id);

ALTER TABLE org_user_competency_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_user_competency_assessments_select"
  ON org_user_competency_assessments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "org_user_competency_assessments_insert"
  ON org_user_competency_assessments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND org_user_competency_assessments.contributor_user_id = auth.uid()
    AND (
      org_user_competency_assessments.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competency_assessments.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "org_user_competency_assessments_update"
  ON org_user_competency_assessments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_competency_assessments.contributor_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competency_assessments.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "org_user_competency_assessments_delete"
  ON org_user_competency_assessments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_competency_assessments.contributor_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competency_assessments.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

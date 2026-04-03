-- Org-scoped user job profile assignment (one row per user per organisation)
CREATE TABLE IF NOT EXISTS org_user_job_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  job_profile_id uuid REFERENCES job_profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

CREATE TABLE IF NOT EXISTS org_user_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES competencies (id) ON DELETE CASCADE,
  current_level text NOT NULL,
  assessment_source text NOT NULL DEFAULT 'self',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id, competency_id)
);

CREATE INDEX IF NOT EXISTS org_user_job_profiles_org_idx ON org_user_job_profiles (organisation_id);
CREATE INDEX IF NOT EXISTS org_user_competencies_org_user_idx ON org_user_competencies (organisation_id, user_id);

ALTER TABLE org_user_job_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_user_competencies ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the organisation may read
CREATE POLICY "org_user_job_profiles_select"
  ON org_user_job_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: target user can edit own row; admin / learning_lead can edit any member in org
CREATE POLICY "org_user_job_profiles_insert"
  ON org_user_job_profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "org_user_job_profiles_update"
  ON org_user_job_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "org_user_job_profiles_delete"
  ON org_user_job_profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "org_user_competencies_select"
  ON org_user_competencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "org_user_competencies_insert"
  ON org_user_competencies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "org_user_competencies_update"
  ON org_user_competencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

CREATE POLICY "org_user_competencies_delete"
  ON org_user_competencies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

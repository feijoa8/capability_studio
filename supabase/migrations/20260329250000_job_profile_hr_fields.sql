-- HR-style role copy: responsibilities, requirements, skills (separate from competency mappings)

CREATE TABLE IF NOT EXISTS job_profile_responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_profile_id uuid NOT NULL REFERENCES job_profiles (id) ON DELETE CASCADE,
  description text NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_profile_responsibilities_job_profile_id_idx
  ON job_profile_responsibilities (job_profile_id);

CREATE TABLE IF NOT EXISTS job_profile_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_profile_id uuid NOT NULL REFERENCES job_profiles (id) ON DELETE CASCADE,
  description text NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_profile_requirements_job_profile_id_idx
  ON job_profile_requirements (job_profile_id);

CREATE TABLE IF NOT EXISTS job_profile_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_profile_id uuid NOT NULL REFERENCES job_profiles (id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_profile_skills_job_profile_id_idx
  ON job_profile_skills (job_profile_id);

-- RLS: access via job_profiles.organisation_id + workspace membership
ALTER TABLE job_profile_responsibilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_profile_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_profile_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_profile_responsibilities_org_access"
  ON job_profile_responsibilities FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
      WHERE jp.id = job_profile_responsibilities.job_profile_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
      WHERE jp.id = job_profile_responsibilities.job_profile_id
    )
  );

CREATE POLICY "job_profile_requirements_org_access"
  ON job_profile_requirements FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
      WHERE jp.id = job_profile_requirements.job_profile_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
      WHERE jp.id = job_profile_requirements.job_profile_id
    )
  );

CREATE POLICY "job_profile_skills_org_access"
  ON job_profile_skills FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
      WHERE jp.id = job_profile_skills.job_profile_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
      WHERE jp.id = job_profile_skills.job_profile_id
    )
  );

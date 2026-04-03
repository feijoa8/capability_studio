-- Practice layer above competency_subjects (Practice → Subject → Competency)
CREATE TABLE IF NOT EXISTS competency_practices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competency_practices_org_idx
  ON competency_practices (organisation_id);

ALTER TABLE competency_subjects
  ADD COLUMN IF NOT EXISTS practice_id uuid REFERENCES competency_practices (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS competency_subjects_practice_idx
  ON competency_subjects (practice_id);

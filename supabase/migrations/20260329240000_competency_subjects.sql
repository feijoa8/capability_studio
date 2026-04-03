-- Parent grouping layer for competencies (Practice / Organisation / etc.)
CREATE TABLE IF NOT EXISTS competency_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competency_subjects_org_idx
  ON competency_subjects (organisation_id);

ALTER TABLE competencies
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES competency_subjects (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS competencies_subject_idx
  ON competencies (subject_id);
